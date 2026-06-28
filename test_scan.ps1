$ErrorActionPreference = 'Stop'
$wia = New-Object -ComObject WIA.DeviceManager
if ($wia.DeviceInfos.Count -eq 0) { throw 'No devices found' }
$device = $wia.DeviceInfos.Item(1).Connect()
$item = $device.Items.Item(1)
Write-Host "Connected to scanner"
