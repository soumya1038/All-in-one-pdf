const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function listDevices() {
    try {
      const script = `
        $ErrorActionPreference = 'Stop'
        $wia = New-Object -ComObject WIA.DeviceManager
        $devices = @()
        foreach ($info in $wia.DeviceInfos) {
            if ($info.Type -eq 1) {
                $devices += [PSCustomObject]@{
                    id = $info.DeviceID
                    name = $info.Properties.Item('Name').Value
                    manufacturer = $info.Properties.Item('Manufacturer').Value
                    model = $info.Properties.Item('Name').Value
                }
            }
        }
        $devices | ConvertTo-Json
      `;
      
      const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
      const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`);
      console.log("Raw stdout:", stdout);
      
      if (!stdout.trim()) {
        console.log("No devices found (stdout empty)");
        return;
      }

      const parsed = JSON.parse(stdout);
      const devices = Array.isArray(parsed) ? parsed : [parsed];
      console.log("Parsed devices:", devices);
    } catch (error) {
      console.error("Error:", error);
    }
}

listDevices();
