const cp = require('child_process');
const util = require('util');
const execAsync = util.promisify(cp.exec);
const script = `
        $ErrorActionPreference = 'Stop'
        $wia = New-Object -ComObject WIA.DeviceManager
        $devices = @()
        foreach ($info in $wia.DeviceInfos) {
            if ($info.Type -eq 1) {
                $devices += [PSCustomObject]@{
                    id = $info.DeviceID
                    name = $info.Properties.Item("Name").Value
                    manufacturer = $info.Properties.Item("Manufacturer").Value
                    model = $info.Properties.Item("Name").Value
                }
            }
        }
        $devices | ConvertTo-Json
`;
execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/\n/g, '; ')}"`).then(res => console.log(res.stdout)).catch(err => console.error(err));
