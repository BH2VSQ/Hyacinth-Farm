# Hyacinth Farm Monitor - Interactive API Tool

param(
    [string]$BaseUrl = "http://127.0.0.1:3000",
    [string]$SessionKey = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ColorSuccess = "Green"
$ColorError = "Red"
$ColorInfo = "Cyan"
$ColorWarning = "Yellow"
$ColorTitle = "Magenta"
$ColorPrompt = "White"

$script:BaseUrl = $BaseUrl
$script:SessionKey = $SessionKey
$script:LastResponse = $null

# Prompt for session key if not provided
if (-not $script:SessionKey) {
    Write-Host "请输入 Session Key (32位字符): " -ForegroundColor $ColorPrompt -NoNewline
    $script:SessionKey = Read-Host
    if ($script:SessionKey.Length -ne 32) {
        Write-Host "错误: Session Key 必须是32位字符" -ForegroundColor $ColorError
        exit 1
    }
}

function Write-Title {
    param([string]$Text)
    Clear-Host
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor $ColorTitle
    Write-Host " $Text" -ForegroundColor $ColorTitle
    Write-Host "================================================================" -ForegroundColor $ColorTitle
    Write-Host ""
}

function Write-Success {
    param([string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor $ColorSuccess
}

function Write-Error-Message {
    param([string]$Text)
    Write-Host "[ERROR] $Text" -ForegroundColor $ColorError
}

function Write-Info {
    param([string]$Text)
    Write-Host "[INFO] $Text" -ForegroundColor $ColorInfo
}

function Get-ISO8601Timestamp {
    return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null,
        [string]$ContentType = "application/json"
    )
    
    try {
        $uri = "$script:BaseUrl$Endpoint"
        Write-Info "Request: $Method $uri"
        
        $headers = @{
            "X-Session-Key" = $script:SessionKey
        }
        
        if ($Method -eq "GET") {
            $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -ErrorAction Stop
        } else {
            $jsonBody = $Body | ConvertTo-Json -Depth 10
            Write-Host "Body:" -ForegroundColor Gray
            Write-Host $jsonBody -ForegroundColor Gray
            
            $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
            $response = Invoke-RestMethod -Uri $uri -Method $Method -Body $utf8Bytes -ContentType "$ContentType; charset=utf-8" -Headers $headers -ErrorAction Stop
        }
        
        $script:LastResponse = $response
        Write-Success "Success"
        Write-Host "Response:" -ForegroundColor Gray
        Write-Host ($response | ConvertTo-Json -Depth 10) -ForegroundColor Gray
        return $true
    } catch {
        Write-Error-Message $_.Exception.Message
        return $false
    }
}

function Wait-UserInput {
    Write-Host ""
    Write-Host "Press any key to continue..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

function Show-MainMenu {
    Write-Title "Hyacinth Farm Monitor - API Tool"
    Write-Host "  Server: $script:BaseUrl" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  [1] Heartbeat API" -ForegroundColor $ColorInfo
    Write-Host "  [2] Sensor Data API" -ForegroundColor $ColorInfo
    Write-Host "  [3] Event API" -ForegroundColor $ColorInfo
    Write-Host "  [4] Debug Log API" -ForegroundColor $ColorInfo
    Write-Host "  [5] Image API" -ForegroundColor $ColorInfo
    Write-Host "  [6] Server Status" -ForegroundColor $ColorInfo
    Write-Host "  [7] Run Full API Test" -ForegroundColor $ColorWarning
    Write-Host "  [0] Exit" -ForegroundColor $ColorError
    Write-Host ""
    Write-Host "Select (0-7): " -NoNewline -ForegroundColor $ColorPrompt
    return Read-Host
}

function Show-HeartbeatMenu {
    Write-Title "Heartbeat API"
    Write-Host "  [1] Send Heartbeat (POST)" -ForegroundColor $ColorInfo
    Write-Host "  [2] Query Status (GET)" -ForegroundColor $ColorInfo
    Write-Host "  [3] Start Loop (every 5s)" -ForegroundColor $ColorWarning
    Write-Host "  [0] Back" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Select (0-3): " -NoNewline -ForegroundColor $ColorPrompt
    return Read-Host
}

function Show-SensorMenu {
    Write-Title "Sensor Data API"
    Write-Host "  [1] Send Preset Data" -ForegroundColor $ColorInfo
    Write-Host "  [2] Send Custom Data" -ForegroundColor $ColorInfo
    Write-Host "  [3] Query Latest (limit=10)" -ForegroundColor $ColorInfo
    Write-Host "  [4] Query by Time Range" -ForegroundColor $ColorInfo
    Write-Host "  [0] Back" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Select (0-4): " -NoNewline -ForegroundColor $ColorPrompt
    return Read-Host
}

function Show-EventMenu {
    Write-Title "Event API"
    Write-Host "  [1] Send Preset Event" -ForegroundColor $ColorInfo
    Write-Host "  [2] Send Custom Event" -ForegroundColor $ColorInfo
    Write-Host "  [3] Query Events" -ForegroundColor $ColorInfo
    Write-Host "  [0] Back" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Select (0-3): " -NoNewline -ForegroundColor $ColorPrompt
    return Read-Host
}

function Show-LogMenu {
    Write-Title "Debug Log API"
    Write-Host "  [1] Send DEBUG Log" -ForegroundColor $ColorInfo
    Write-Host "  [2] Send INFO Log" -ForegroundColor $ColorInfo
    Write-Host "  [3] Send WARN Log" -ForegroundColor $ColorWarning
    Write-Host "  [4] Send ERROR Log" -ForegroundColor $ColorError
    Write-Host "  [5] Send Custom Log" -ForegroundColor $ColorInfo
    Write-Host "  [6] Query Logs" -ForegroundColor $ColorInfo
    Write-Host "  [0] Back" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Select (0-6): " -NoNewline -ForegroundColor $ColorPrompt
    return Read-Host
}

function Show-ImageMenu {
    Write-Title "Image API"
    Write-Host "  [1] Upload Image (file path)" -ForegroundColor $ColorInfo
    Write-Host "  [2] Query Image List" -ForegroundColor $ColorInfo
    Write-Host "  [3] Query with Pagination" -ForegroundColor $ColorInfo
    Write-Host "  [0] Back" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Select (0-3): " -NoNewline -ForegroundColor $ColorPrompt
    return Read-Host
}

function Handle-Heartbeat {
    while ($true) {
        $choice = Show-HeartbeatMenu
        
        switch ($choice) {
            "1" {
                Write-Title "Send Heartbeat"
                Write-Host "Enter heartbeat parameters:" -ForegroundColor $ColorInfo
                Write-Host ""
                
                $interval = Read-Host "Heartbeat interval (seconds) [60]"
                $intervalValue = if ($interval) { [int]$interval } else { 60 }
                
                $timestamp = Get-ISO8601Timestamp
                $nextHeartbeat = (Get-Date).AddSeconds($intervalValue).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                
                $body = @{ 
                    timestamp = $timestamp
                    interval = $intervalValue
                    nextHeartbeat = $nextHeartbeat
                }
                
                Write-Host "Next heartbeat expected at: $nextHeartbeat" -ForegroundColor Gray
                Write-Host ""
                
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/heartbeat" -Body $body
                Wait-UserInput
            }
            "2" {
                Write-Title "Query Heartbeat Status"
                Invoke-ApiRequest -Method "GET" -Endpoint "/api/heartbeat"
                Wait-UserInput
            }
            "3" {
                Write-Title "Heartbeat Loop (Press Ctrl+C to stop)"
                Write-Host ""
                
                $loopInterval = Read-Host "Loop interval (seconds) [5]"
                $loopIntervalValue = if ($loopInterval) { [int]$loopInterval } else { 5 }
                
                Write-Host "Sending heartbeat every $loopIntervalValue seconds..." -ForegroundColor $ColorInfo
                Write-Host ""
                
                try {
                    while ($true) {
                        $timestamp = Get-ISO8601Timestamp
                        $nextHeartbeat = (Get-Date).AddSeconds($loopIntervalValue).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                        
                        $body = @{ 
                            timestamp = $timestamp
                            interval = $loopIntervalValue
                            nextHeartbeat = $nextHeartbeat
                        }
                        
                        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -NoNewline -ForegroundColor $ColorInfo
                        if (Invoke-ApiRequest -Method "POST" -Endpoint "/api/heartbeat" -Body $body) {
                            Write-Host ""
                        }
                        Start-Sleep -Seconds $loopIntervalValue
                    }
                } catch {
                    Write-Host ""
                    Write-Info "Loop stopped"
                }
                Wait-UserInput
            }
            "0" { return }
            default { Write-Warning "Invalid choice"; Start-Sleep -Seconds 1 }
        }
    }
}

function Handle-Sensor {
    while ($true) {
        $choice = Show-SensorMenu
        
        switch ($choice) {
            "1" {
                Write-Title "Send Preset Sensor Data"
                $data = @{
                    timestamp = Get-ISO8601Timestamp
                    temperature = 22.5
                    soil_moisture = 45.8
                    light = 850
                    pressure = 101.3
                    voltage = 3.7
                }
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/data" -Body $data
                Wait-UserInput
            }
            "2" {
                Write-Title "Send Custom Sensor Data"
                Write-Host "Enter values (leave empty for default):" -ForegroundColor $ColorInfo
                Write-Host ""
                
                $temp = Read-Host "Temperature (C) [22.5]"
                $soil = Read-Host "Soil Moisture (%) [45.0]"
                $light = Read-Host "Light [800]"
                $pres = Read-Host "Pressure (kPa) [101.3]"
                $volt = Read-Host "Voltage (V) [3.7]"
                
                $data = @{
                    timestamp = Get-ISO8601Timestamp
                    temperature = if ($temp) { [double]$temp } else { 22.5 }
                    soil_moisture = if ($soil) { [double]$soil } else { 45.0 }
                    light = if ($light) { [double]$light } else { 800 }
                    pressure = if ($pres) { [double]$pres } else { 101.3 }
                    voltage = if ($volt) { [double]$volt } else { 3.7 }
                }
                
                Write-Host ""
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/data" -Body $data
                Wait-UserInput
            }
            "3" {
                Write-Title "Query Latest Data"
                Invoke-ApiRequest -Method "GET" -Endpoint "/api/data?limit=10"
                Wait-UserInput
            }
            "4" {
                Write-Title "Query by Time Range"
                Write-Host "Format: yyyy-MM-ddTHH:mm:ss (e.g. 2026-03-27T10:00:00)" -ForegroundColor Gray
                Write-Host ""
                
                $start = Read-Host "Start time (empty=1 hour ago)"
                $end = Read-Host "End time (empty=now)"
                
                $startTime = if ($start) { $start } else { (Get-Date).AddHours(-1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
                $endTime = if ($end) { $end } else { Get-ISO8601Timestamp }
                
                $endpoint = "/api/data?start=$startTime" + "&end=$endTime" + "&limit=100"
                Write-Host ""
                Invoke-ApiRequest -Method "GET" -Endpoint $endpoint
                Wait-UserInput
            }
            "0" { return }
            default { Write-Warning "Invalid choice"; Start-Sleep -Seconds 1 }
        }
    }
}

function Handle-Event {
    while ($true) {
        $choice = Show-EventMenu
        
        switch ($choice) {
            "1" {
                Write-Title "Send Preset Event"
                Write-Host "  [1] watering_start" -ForegroundColor $ColorInfo
                Write-Host "  [2] watering_stop" -ForegroundColor $ColorInfo
                Write-Host "  [3] watering_refill" -ForegroundColor $ColorInfo
                Write-Host "  [4] pump_error" -ForegroundColor $ColorError
                Write-Host "  [5] sensor_error" -ForegroundColor $ColorError
                Write-Host "  [6] boot" -ForegroundColor $ColorSuccess
                Write-Host ""
                $eventChoice = Read-Host "Select event (1-6)"
                
                $eventMap = @{
                    "1" = @{ event = "watering_start"; detail = "Soil moisture below threshold, start watering" }
                    "2" = @{ event = "watering_stop"; detail = "Target moisture reached, stop watering" }
                    "3" = @{ event = "watering_refill"; detail = "Water tank low, need refill" }
                    "4" = @{ event = "pump_error"; detail = "Pump malfunction, check hardware" }
                    "5" = @{ event = "sensor_error"; detail = "Sensor reading abnormal, check connection" }
                    "6" = @{ event = "boot"; detail = "ESP32 boot complete, system initialized" }
                }
                
                if ($eventMap.ContainsKey($eventChoice)) {
                    $data = @{
                        timestamp = Get-ISO8601Timestamp
                        event = $eventMap[$eventChoice].event
                        detail = $eventMap[$eventChoice].detail
                    }
                    Write-Host ""
                    Invoke-ApiRequest -Method "POST" -Endpoint "/api/event" -Body $data
                } else {
                    Write-Warning "Invalid choice"
                }
                Wait-UserInput
            }
            "2" {
                Write-Title "Send Custom Event"
                $eventName = Read-Host "Event name"
                $eventDetail = Read-Host "Event detail"
                
                $data = @{
                    timestamp = Get-ISO8601Timestamp
                    event = $eventName
                    detail = $eventDetail
                }
                
                Write-Host ""
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/event" -Body $data
                Wait-UserInput
            }
            "3" {
                Write-Title "Query Events"
                $limit = Read-Host "Limit [30]"
                $limitValue = if ($limit) { $limit } else { "30" }
                Invoke-ApiRequest -Method "GET" -Endpoint "/api/events?limit=$limitValue"
                Wait-UserInput
            }
            "0" { return }
            default { Write-Warning "Invalid choice"; Start-Sleep -Seconds 1 }
        }
    }
}

function Handle-Log {
    while ($true) {
        $choice = Show-LogMenu
        
        switch ($choice) {
            "1" {
                Write-Title "Send DEBUG Log"
                $message = Read-Host "Message [WiFi RSSI: -65 dBm]"
                $msg = if ($message) { $message } else { "WiFi RSSI: -65 dBm" }
                $data = @{ timestamp = Get-ISO8601Timestamp; level = "DEBUG"; message = $msg }
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/log" -Body $data
                Wait-UserInput
            }
            "2" {
                Write-Title "Send INFO Log"
                $message = Read-Host "Message [Sensor read success]"
                $msg = if ($message) { $message } else { "Sensor read success" }
                $data = @{ timestamp = Get-ISO8601Timestamp; level = "INFO"; message = $msg }
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/log" -Body $data
                Wait-UserInput
            }
            "3" {
                Write-Title "Send WARN Log"
                $message = Read-Host "Message [Soil moisture low]"
                $msg = if ($message) { $message } else { "Soil moisture low, watering recommended" }
                $data = @{ timestamp = Get-ISO8601Timestamp; level = "WARN"; message = $msg }
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/log" -Body $data
                Wait-UserInput
            }
            "4" {
                Write-Title "Send ERROR Log"
                $message = Read-Host "Message [Sensor connection failed]"
                $msg = if ($message) { $message } else { "Sensor connection failed, check hardware" }
                $data = @{ timestamp = Get-ISO8601Timestamp; level = "ERROR"; message = $msg }
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/log" -Body $data
                Wait-UserInput
            }
            "5" {
                Write-Title "Send Custom Log"
                $level = Read-Host "Level (DEBUG/INFO/WARN/ERROR) [INFO]"
                $message = Read-Host "Message"
                $lvl = if ($level) { $level.ToUpper() } else { "INFO" }
                $data = @{ timestamp = Get-ISO8601Timestamp; level = $lvl; message = $message }
                Write-Host ""
                Invoke-ApiRequest -Method "POST" -Endpoint "/api/log" -Body $data
                Wait-UserInput
            }
            "6" {
                Write-Title "Query Logs"
                $level = Read-Host "Filter level (DEBUG/INFO/WARN/ERROR, empty=all)"
                $limit = Read-Host "Limit [50]"
                $limitValue = if ($limit) { $limit } else { "50" }
                $endpoint = if ($level) { "/api/logs?level=$level" + "&limit=$limitValue" } else { "/api/logs?limit=$limitValue" }
                Invoke-ApiRequest -Method "GET" -Endpoint $endpoint
                Wait-UserInput
            }
            "0" { return }
            default { Write-Warning "Invalid choice"; Start-Sleep -Seconds 1 }
        }
    }
}

function Handle-Image {
    while ($true) {
        $choice = Show-ImageMenu
        
        switch ($choice) {
            "1" {
                Write-Title "Upload Image"
                $imagePath = Read-Host "Image path (jpg/jpeg/png)"
                
                if (-not (Test-Path $imagePath)) {
                    Write-Error-Message "File not found: $imagePath"
                    Wait-UserInput
                    continue
                }
                
                try {
                    $timestamp = Get-ISO8601Timestamp
                    $uri = "$script:BaseUrl/api/image?timestamp=$timestamp"
                    
                    Write-Info "Uploading..."
                    $fileBytes = [System.IO.File]::ReadAllBytes($imagePath)
                    
                    $headers = @{
                        "X-Session-Key" = $script:SessionKey
                    }
                    
                    $response = Invoke-RestMethod -Uri $uri -Method Post -Body $fileBytes -ContentType "image/jpeg" -Headers $headers -ErrorAction Stop
                    
                    Write-Success "Upload success"
                    Write-Host "Response:" -ForegroundColor Gray
                    Write-Host ($response | ConvertTo-Json) -ForegroundColor Gray
                } catch {
                    Write-Error-Message "Upload failed: $($_.Exception.Message)"
                }
                
                Wait-UserInput
            }
            "2" {
                Write-Title "Query Image List"
                $limit = Read-Host "Limit [20]"
                $limitValue = if ($limit) { $limit } else { "20" }
                Invoke-ApiRequest -Method "GET" -Endpoint "/api/images?limit=$limitValue"
                Wait-UserInput
            }
            "3" {
                Write-Title "Query with Pagination"
                $limit = Read-Host "Per page [10]"
                $offset = Read-Host "Offset [0]"
                $limitValue = if ($limit) { $limit } else { "10" }
                $offsetValue = if ($offset) { $offset } else { "0" }
                $endpoint = "/api/images?limit=$limitValue" + "&offset=$offsetValue"
                Invoke-ApiRequest -Method "GET" -Endpoint $endpoint
                Wait-UserInput
            }
            "0" { return }
            default { Write-Warning "Invalid choice"; Start-Sleep -Seconds 1 }
        }
    }
}

function Handle-Status {
    Write-Title "Server Status"
    Invoke-ApiRequest -Method "GET" -Endpoint "/api/status"
    Wait-UserInput
}

function Run-FullTest {
    Write-Title "Run Full API Test"
    Write-Host "Running all API tests..." -ForegroundColor $ColorInfo
    Write-Host "Start time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
    Write-Host ""
    
    $script:TestTotal = 0
    $script:TestPassed = 0
    $script:TestFailed = 0
    
    function Test-Api {
        param([string]$Name, [string]$Method, [string]$Endpoint, [object]$Body = $null)
        $script:TestTotal++
        try {
            $uri = "$script:BaseUrl$Endpoint"
            $headers = @{
                "X-Session-Key" = $script:SessionKey
            }
            
            if ($Method -eq "GET") {
                $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -ErrorAction Stop
            } else {
                $jsonBody = $Body | ConvertTo-Json -Depth 10
                $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
                $response = Invoke-RestMethod -Uri $uri -Method $Method -Body $utf8Bytes -ContentType "application/json; charset=utf-8" -Headers $headers -ErrorAction Stop
            }
            $script:TestPassed++
            Write-Host "  [OK] " -NoNewline -ForegroundColor $ColorSuccess
            Write-Host $Name -ForegroundColor $ColorSuccess
            return $response
        } catch {
            $script:TestFailed++
            Write-Host "  [FAIL] " -NoNewline -ForegroundColor $ColorError
            Write-Host "$Name - $($_.Exception.Message)" -ForegroundColor $ColorError
            return $null
        }
    }
    
    # Test 1: Server Status
    Write-Host "--- 1. Server Status ---" -ForegroundColor $ColorInfo
    $result = Test-Api -Name "GET /api/status" -Method "GET" -Endpoint "/api/status"
    if ($result) {
        Write-Host "       Uptime: $([math]::Round($result.uptime, 2))s" -ForegroundColor Gray
    }
    Write-Host ""
    
    # Test 2: Heartbeat
    Write-Host "--- 2. Heartbeat API ---" -ForegroundColor $ColorInfo
    $timestamp = Get-ISO8601Timestamp
    $nextTime = (Get-Date).AddSeconds(60).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    Test-Api -Name "POST /api/heartbeat" -Method "POST" -Endpoint "/api/heartbeat" -Body @{ 
        timestamp = $timestamp
        interval = 60
        nextHeartbeat = $nextTime
    }
    Start-Sleep -Milliseconds 500
    $result = Test-Api -Name "GET /api/heartbeat" -Method "GET" -Endpoint "/api/heartbeat"
    if ($result) {
        Write-Host "       Online: $($result.isOnline), Interval: $($result.interval)s" -ForegroundColor Gray
    }
    Write-Host ""
    
    # Test 3: Sensor Data
    Write-Host "--- 3. Sensor Data API ---" -ForegroundColor $ColorInfo
    Test-Api -Name "POST /api/data" -Method "POST" -Endpoint "/api/data" -Body @{
        timestamp = Get-ISO8601Timestamp
        temperature = 22.5
        soil_moisture = 45.8
        light = 850
        pressure = 101.3
        voltage = 3.7
    }
    Start-Sleep -Milliseconds 500
    Test-Api -Name "GET /api/data" -Method "GET" -Endpoint "/api/data?limit=5"
    $endTime = Get-ISO8601Timestamp
    $startTime = (Get-Date).AddHours(-1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    Test-Api -Name "GET /api/data (time range)" -Method "GET" -Endpoint "/api/data?start=$startTime&end=$endTime&limit=10"
    Write-Host ""
    
    # Test 4: Events
    Write-Host "--- 4. Event API ---" -ForegroundColor $ColorInfo
    Test-Api -Name "POST /api/event" -Method "POST" -Endpoint "/api/event" -Body @{
        timestamp = Get-ISO8601Timestamp
        event = "test_event"
        detail = "API test event"
    }
    Start-Sleep -Milliseconds 500
    Test-Api -Name "GET /api/events" -Method "GET" -Endpoint "/api/events?limit=5"
    Write-Host ""
    
    # Test 5: Debug Logs
    Write-Host "--- 5. Debug Log API ---" -ForegroundColor $ColorInfo
    $logLevels = @("DEBUG", "INFO", "WARN", "ERROR")
    foreach ($level in $logLevels) {
        Test-Api -Name "POST /api/log ($level)" -Method "POST" -Endpoint "/api/log" -Body @{
            timestamp = Get-ISO8601Timestamp
            level = $level
            message = "Test log - $level level"
        }
    }
    Start-Sleep -Milliseconds 500
    Test-Api -Name "GET /api/logs" -Method "GET" -Endpoint "/api/logs?limit=10"
    Test-Api -Name "GET /api/logs (ERROR filter)" -Method "GET" -Endpoint "/api/logs?level=ERROR&limit=5"
    Write-Host ""
    
    # Test 6: Images
    Write-Host "--- 6. Image API ---" -ForegroundColor $ColorInfo
    Test-Api -Name "GET /api/images" -Method "GET" -Endpoint "/api/images?limit=10"
    Test-Api -Name "GET /api/images (pagination)" -Method "GET" -Endpoint "/api/images?limit=5&offset=0"
    Write-Host ""
    
    # Summary
    Write-Host "================================================================" -ForegroundColor $ColorTitle
    Write-Host " Test Summary" -ForegroundColor $ColorTitle
    Write-Host "================================================================" -ForegroundColor $ColorTitle
    Write-Host ""
    
    $passRate = if ($script:TestTotal -gt 0) { 
        [math]::Round(($script:TestPassed / $script:TestTotal) * 100, 2) 
    } else { 
        0 
    }
    
    Write-Host "  Total Tests: " -NoNewline
    Write-Host $script:TestTotal -ForegroundColor $ColorInfo
    
    Write-Host "  Passed:      " -NoNewline
    Write-Host $script:TestPassed -ForegroundColor $ColorSuccess
    
    Write-Host "  Failed:      " -NoNewline
    Write-Host $script:TestFailed -ForegroundColor $(if ($script:TestFailed -eq 0) { $ColorSuccess } else { $ColorError })
    
    Write-Host "  Pass Rate:   " -NoNewline
    Write-Host "$passRate%" -ForegroundColor $(if ($passRate -eq 100) { $ColorSuccess } elseif ($passRate -ge 80) { $ColorWarning } else { $ColorError })
    
    Write-Host ""
    Write-Host "Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
    Write-Host ""
    
    if ($script:TestFailed -eq 0) {
        Write-Host "All tests passed!" -ForegroundColor $ColorSuccess
    } else {
        Write-Host "Some tests failed. Check server logs." -ForegroundColor $ColorWarning
    }
    
    Wait-UserInput
}

function Main {
    while ($true) {
        $choice = Show-MainMenu
        
        switch ($choice) {
            "1" { Handle-Heartbeat }
            "2" { Handle-Sensor }
            "3" { Handle-Event }
            "4" { Handle-Log }
            "5" { Handle-Image }
            "6" { Handle-Status }
            "7" { Run-FullTest }
            "0" {
                Write-Host ""
                Write-Host "Goodbye!" -ForegroundColor $ColorSuccess
                Write-Host ""
                exit
            }
            default {
                Write-Warning "Invalid choice, please enter 0-7"
                Start-Sleep -Seconds 1
            }
        }
    }
}

Main
