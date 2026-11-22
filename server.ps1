param(
    [int]$Port = 8765,
    [switch]$NoBrowser
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Script:LastImgHash = ""
$Script:LastImgOcrText = ""
$Script:LastImgB64 = ""
$Script:OcrReady = $false
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
    $Script:AsTaskMethod = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    $Script:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -ne $Script:OcrEngine -and $null -ne $Script:AsTaskMethod) {
        $Script:OcrReady = $true
    }
} catch {}

function Invoke-WinRtAwait($WinRtTask, $ResultType) {
    $generic = $Script:AsTaskMethod.MakeGenericMethod($ResultType)
    $netTask = $generic.Invoke($null, @($WinRtTask))
    $netTask.Wait(4000) | Out-Null
    return $netTask.Result
}

function Get-QuickSha256([byte[]]$Bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash($Bytes)
    $sha.Dispose()
    return ([BitConverter]::ToString($hashBytes) -replace '-', '').Substring(0, 20)
}

function Get-KindleClipboardSnapshot() {
    try {
        if ([System.Windows.Forms.Clipboard]::ContainsText()) {
            $txt = ([System.Windows.Forms.Clipboard]::GetText()).Trim()
            if ($txt.Length -ge 6 -and $txt.Length -le 4500) {
                # Ignore URLs, API tokens, or non-English snippets
                if ($txt -notmatch '^(https?://|ntn_|secret_|AIza|sk-)' -and $txt -match '[a-zA-Z]{3,}') {
                    $h = Get-QuickSha256 ([System.Text.Encoding]::UTF8.GetBytes($txt))
                    return @{ ok = $true; kind = "text"; hash = "txt_$h"; text = $txt }
                }
            }
        }
        elseif ([System.Windows.Forms.Clipboard]::ContainsImage()) {
            $img = [System.Windows.Forms.Clipboard]::GetImage()
            if ($null -ne $img) {
                $ms = New-Object System.IO.MemoryStream
                $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $pngBytes = $ms.ToArray()
                $ms.Dispose()
                $img.Dispose()

                $imgHash = "img_" + (Get-QuickSha256 $pngBytes)
                if ($imgHash -ne $Script:LastImgHash) {
                    $Script:LastImgHash = $imgHash
                    $Script:LastImgB64 = [Convert]::ToBase64String($pngBytes)
                    $Script:LastImgOcrText = ""
                    if ($Script:OcrReady) {
                        try {
                            $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
                            $dw = New-Object Windows.Storage.Streams.DataWriter($ras.GetOutputStreamAt(0))
                            $dw.WriteBytes($pngBytes)
                            $null = $dw.StoreAsync().GetResults()
                            $dec = Invoke-WinRtAwait ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
                            $sbmp = Invoke-WinRtAwait ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
                            $ocrRes = Invoke-WinRtAwait ($Script:OcrEngine.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
                            $Script:LastImgOcrText = ([string]$ocrRes.Text).Trim()
                        } catch {}
                    }
                }
                if ($Script:LastImgOcrText.Length -ge 4 -or $Script:LastImgB64.Length -gt 100) {
                    return @{
                        ok          = $true
                        kind        = "image"
                        hash        = $Script:LastImgHash
                        text        = $Script:LastImgOcrText
                        imageBase64 = $Script:LastImgB64
                    }
                }
            }
        }
    } catch {}
    return @{ ok = $true; kind = "empty"; hash = "" }
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".ico"  = "image/x-icon"
}

function Get-YouTubeClipCaptions([string]$VideoId) {
    $body = @{
        context = @{
            client = @{
                clientName = "ANDROID"
                clientVersion = "20.10.38"
                androidSdkVersion = 34
                hl = "en"
                gl = "US"
            }
        }
        videoId = $VideoId
    } | ConvertTo-Json -Depth 5

    $headers = @{
        "User-Agent" = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
        "Content-Type" = "application/json"
    }

    $resp = Invoke-RestMethod -Method Post -Uri "https://www.youtube.com/youtubei/v1/player?prettyPrint=false" -Headers $headers -Body $body -ErrorAction Stop
    if (-not $resp.playabilityStatus.playableInEmbed) {
        return @{ error = "이 유튜브 영상은 업로더 설정에 의해 외부 플레이어 임베드가 제한되어 있습니다." }
    }
    $tracks = $resp.captions.playerCaptionsTracklistRenderer.captionTracks
    $selected = $tracks | Where-Object { $_.languageCode -like "en*" -and -not $_.kind } | Select-Object -First 1
    if (-not $selected) {
        $selected = $tracks | Where-Object { $_.languageCode -like "en*" } | Select-Object -First 1
    }
    if (-not $selected) {
        return @{ error = "영어 자막 트랙이 없는 영상입니다." }
    }

    $xmlRaw = (Invoke-WebRequest -Uri $selected.baseUrl -Headers @{"User-Agent"="com.google.android.youtube/20.10.38 (Linux; U; Android 14)"} -UseBasicParsing).Content
    [xml]$doc = $xmlRaw
    $lines = New-Object System.Collections.Generic.List[object]

    $ps = $doc.SelectNodes("//p")
    if ($ps -and $ps.Count -gt 0) {
        foreach ($node in $ps) {
            $tMs = $node.GetAttribute("t")
            $dMs = $node.GetAttribute("d")
            if (-not $tMs) { continue }
            $st = [math]::Round(([double]$tMs) / 1000.0, 2)
            $dur = if ($dMs) { ([double]$dMs) / 1000.0 } else { 2.5 }
            $end = [math]::Round($st + [math]::Min($dur, 6.0), 2)
            $txt = ([System.Web.HttpUtility]::HtmlDecode($node.InnerText) -replace '\[.*?\]|\(.*?\)', '' -replace '^\s*-\s*', '' -replace '\s+', ' ').Trim()
            if ($txt.Length -ge 3) {
                $lines.Add(@{
                    start = $st
                    end = $end
                    speaker = "Speaker"
                    en = $txt
                    ko = "(직접 추가한 유튜브 클립 대사입니다)"
                    vocab = @()
                    grammar = @{ title = "실전 청취 연습"; desc = "임포트된 자막으로 대사 구간 반복 및 받아쓰기를 연습해 보세요." }
                })
            }
        }
    } else {
        foreach ($node in $doc.SelectNodes("//text")) {
            $st = [math]::Round([double]$node.GetAttribute("start"), 2)
            $dur = [double]$node.GetAttribute("dur")
            $end = [math]::Round($st + [math]::Min($dur, 6.0), 2)
            $txt = ([System.Web.HttpUtility]::HtmlDecode($node.InnerText) -replace '\[.*?\]|\(.*?\)', '' -replace '^\s*-\s*', '' -replace '\s+', ' ').Trim()
            if ($txt.Length -ge 3) {
                $lines.Add(@{
                    start = $st
                    end = $end
                    speaker = "Speaker"
                    en = $txt
                    ko = "(직접 추가한 유튜브 클립 대사입니다)"
                    vocab = @()
                    grammar = @{ title = "실전 청취 연습"; desc = "임포트된 자막으로 대사 구간 반복 및 받아쓰기를 연습해 보세요." }
                })
            }
        }
    }

    # Clamp overlapping rolling caption durations so each line stops cleanly before the next line starts
    for ($i = 0; $i -lt ($lines.Count - 1); $i++) {
        $nextStart = [double]$lines[$i + 1].start
        if ([double]$lines[$i].end -gt $nextStart) {
            $lines[$i].end = [math]::Round([math]::Max([double]$lines[$i].start + 0.5, $nextStart - 0.03), 2)
        }
    }

    return @{
        videoId = $VideoId
        title = $resp.videoDetails.title
        channel = $resp.videoDetails.author
        isManualCaption = (-not [bool]$selected.kind)
        lines = $lines
    }
}

$listener = New-Object System.Net.HttpListener
$url = "http://localhost:$Port/"
$listener.Prefixes.Add($url)
$listener.Start()

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  미드 영어 받아쓰기 스튜디오 서버가 실행되었습니다!" -ForegroundColor Green
Write-Host "  접속 주소: $url" -ForegroundColor Yellow
Write-Host "  종료하려면 이 창을 닫거나 Ctrl+C를 누르세요." -ForegroundColor Gray
Write-Host "=====================================================" -ForegroundColor Cyan

if (-not $NoBrowser) {
    Start-Process $url
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response
        $res.Headers.Add("Referrer-Policy", "strict-origin-when-cross-origin")
        $res.Headers.Add("Cache-Control", "no-store")

        $path = $req.Url.LocalPath
        if ($path -eq "/api/kindle-clipboard" -and $req.HttpMethod -eq "GET") {
            $snap = Get-KindleClipboardSnapshot
            $snapBytes = [System.Text.Encoding]::UTF8.GetBytes(($snap | ConvertTo-Json -Depth 6 -Compress))
            $res.ContentType = "application/json; charset=utf-8"
            $res.ContentLength64 = $snapBytes.Length
            $res.OutputStream.Write($snapBytes, 0, $snapBytes.Length)
            $res.OutputStream.Close()
            continue
        }

        if ($path -eq "/api/notion-proxy" -and $req.HttpMethod -eq "POST") {
            try {
                $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $rawBody = $reader.ReadToEnd()
                $reader.Close()
                $payload = $rawBody | ConvertFrom-Json

                $nToken = ([string]$payload.token).Trim()
                $nMethod = if ($payload.method) { [string]$payload.method } else { "GET" }
                $nPath = [string]$payload.path
                $nUri = "https://api.notion.com/v1$nPath"

                $nHeaders = @{
                    "Authorization"  = "Bearer $nToken"
                    "Notion-Version" = "2022-06-28"
                }

                $iwrParams = @{
                    Uri             = $nUri
                    Method          = $nMethod
                    Headers         = $nHeaders
                    UseBasicParsing = $true
                    ErrorAction     = "Stop"
                }

                if ($null -ne $payload.body -and $nMethod -ne "GET") {
                    $bodyJson = $payload.body | ConvertTo-Json -Depth 12 -Compress
                    $iwrParams["Body"] = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
                    $iwrParams["ContentType"] = "application/json; charset=utf-8"
                }

                try {
                    $nResp = Invoke-WebRequest @iwrParams
                    $respText = [System.Text.Encoding]::UTF8.GetString($nResp.RawContentStream.ToArray())
                    $parsedData = if ($respText) { $respText | ConvertFrom-Json } else { @{} }
                    $outObj = @{ ok = $true; status = [int]$nResp.StatusCode; data = $parsedData }
                } catch [System.Net.WebException] {
                    $wResp = $_.Exception.Response
                    $code = if ($wResp) { [int]$wResp.StatusCode } else { 500 }
                    $errObj = @{ message = $_.Exception.Message }
                    if ($wResp) {
                        $sReader = New-Object System.IO.StreamReader($wResp.GetResponseStream(), [System.Text.Encoding]::UTF8)
                        $errStr = $sReader.ReadToEnd()
                        $sReader.Close()
                        if ($errStr) { try { $errObj = $errStr | ConvertFrom-Json } catch {} }
                    }
                    $outObj = @{ ok = $false; status = $code; data = $errObj }
                }

                $outBytes = [System.Text.Encoding]::UTF8.GetBytes(($outObj | ConvertTo-Json -Depth 12))
                $res.ContentType = "application/json; charset=utf-8"
                $res.ContentLength64 = $outBytes.Length
                $res.OutputStream.Write($outBytes, 0, $outBytes.Length)
            } catch {
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes((@{ ok = $false; status = 500; data = @{ message = $_.Exception.Message } } | ConvertTo-Json))
                $res.StatusCode = 500
                $res.ContentType = "application/json; charset=utf-8"
                $res.ContentLength64 = $errBytes.Length
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            $res.OutputStream.Close()
            continue
        }

        if ($path -eq "/api/import") {
            $vid = $req.QueryString["v"]
            try {
                $data = Get-YouTubeClipCaptions -VideoId $vid
                $json = $data | ConvertTo-Json -Depth 8
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $res.ContentType = "application/json; charset=utf-8"
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $errJson = @{ error = "유튜브 자막을 불러오는 중 오류가 발생했습니다: $($_.Exception.Message)" } | ConvertTo-Json
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                $res.StatusCode = 500
                $res.ContentType = "application/json; charset=utf-8"
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $res.OutputStream.Close()
            continue
        }

        if ($path -eq "/") { $path = "/index.html" }
        $safeRel = $path.TrimStart('/') -replace '/', '\'
        $filePath = Join-Path $Root $safeRel

        if ((Test-Path $filePath -PathType Leaf)) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $res.ContentType = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
        $res.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
