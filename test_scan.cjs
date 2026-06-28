const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const sharp = require('sharp');

async function testScan() {
    try {
      const deviceId = '{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\\0000'; // user's device id
      const intent = 1;
      const resolution = 150;
      const imagePath = __dirname + '\\test_scan.jpg';

      // Delete existing file
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }

      const script = `
        $ErrorActionPreference = 'Stop'
        $wia = New-Object -ComObject WIA.DeviceManager
        
        $deviceInfo = $null
        foreach ($info in $wia.DeviceInfos) {
            if ($info.DeviceID -eq '${deviceId}') {
                $deviceInfo = $info
                break
            }
        }
        if (-not $deviceInfo) { throw 'Device not found' }
        
        $device = $deviceInfo.Connect()
        $item = $device.Items.Item(1)
        
        $item.Properties.Item('6146').Value = ${intent}
        $item.Properties.Item('6147').Value = ${resolution}
        $item.Properties.Item('6148').Value = ${resolution}
        
        $image = $item.Transfer()
        
        $imageProcess = New-Object -ComObject WIA.ImageProcess
        $imageProcess.Filters.Add($imageProcess.FilterInfos.Item('Convert').FilterID)
        $imageProcess.Filters.Item(1).Properties.Item('FormatID').Value = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
        $imageProcess.Filters.Item(1).Properties.Item('Quality').Value = 90
        $image = $imageProcess.Apply($image)
        
        $image.SaveFile('${imagePath.replace(/\\/g, '\\\\')}')
      `;
      
      const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
      await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`);
      
      console.log("Scan physical success. Testing sharp...");
      
      await sharp(imagePath).resize(400, 400).toBuffer();
      console.log("Sharp parsed the scanned image successfully!");
      
    } catch (error) {
      console.error("Test Error:", error);
    }
}

testScan();
