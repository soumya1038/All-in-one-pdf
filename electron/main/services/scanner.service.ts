import { exec } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { ScannerDevice, ScanSettings, ScanResult, ScanColorMode } from '../../../src/types/Scanner.types';
import { getTempFilePath } from '../utils/tempDir';
import sharp from 'sharp';

const execAsync = promisify(exec);

/**
 * Service for scanner operations utilizing Windows Image Acquisition (WIA) via PowerShell
 */
export class ScannerService {
  /**
   * List available scanners
   */
  async listDevices(): Promise<Result<ScannerDevice[]>> {
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
      
      if (!stdout.trim()) {
        return { success: true, data: [] };
      }

      const parsed = JSON.parse(stdout);
      const devices: ScannerDevice[] = Array.isArray(parsed) ? parsed : [parsed];
      
      return { success: true, data: devices };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.SCANNER_NOT_FOUND,
          message: 'Failed to enumerate scanners. Make sure WIA is running.',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Check if specific scanner is available
   */
  async checkDevice(deviceId: string): Promise<Result<boolean>> {
    try {
      const devicesResult = await this.listDevices();
      if (!devicesResult.success) return { success: true, data: false };
      
      const exists = devicesResult.data.some(d => d.id === deviceId);
      return { success: true, data: exists };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.SCANNER_NOT_FOUND,
          message: 'Scanner not found',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Perform scan operation
   */
  async scan(deviceId: string, settings: ScanSettings): Promise<Result<ScanResult>> {
    try {
      const tempId = uuidv4();
      const imagePath = getTempFilePath(`scan_${tempId}.jpg`);

      // 1 = Color, 2 = Grayscale, 4 = Black & White
      let intent = 1;
      if (settings.colorMode === ScanColorMode.GRAYSCALE) intent = 2;
      if (settings.colorMode === ScanColorMode.BLACK_AND_WHITE) intent = 4;

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
        $item.Properties.Item('6147').Value = ${settings.resolution}
        $item.Properties.Item('6148').Value = ${settings.resolution}
        
        $image = $item.Transfer()
        
        # Use WIA ImageProcess to explicitly convert the image to JPEG
        $imageProcess = New-Object -ComObject WIA.ImageProcess
        $imageProcess.Filters.Add($imageProcess.FilterInfos.Item('Convert').FilterID)
        $imageProcess.Filters.Item(1).Properties.Item('FormatID').Value = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
        $imageProcess.Filters.Item(1).Properties.Item('Quality').Value = 90
        $image = $imageProcess.Apply($image)
        
        $image.SaveFile('${imagePath}')
      `;

      const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
      await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`);
      
      const fileStats = await stat(imagePath);
      const metadata = await sharp(imagePath).metadata();

      return {
        success: true,
        data: {
          imagePath,
          format: 'jpg',
          size: fileStats.size,
          dimensions: {
            width: metadata.width || 0,
            height: metadata.height || 0,
          },
          estimatedDpi: settings.resolution,
          isBlank: false, // Could be determined through image analysis later
        }
      };
    } catch (error) {
      console.error('Scan Error in scanner.service.ts:', error);
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Scan failed. Ensure the scanner is connected and turned on.',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }
}
