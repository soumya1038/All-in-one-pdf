const { OutputService } = require('./electron/main/services/output.service.ts');
const { OutputFormat } = require('./src/types/Output.types.ts');
const { ErrorCode } = require('./src/types/Error.types.ts');
const { FileService } = require('./electron/main/services/file.service.ts');

async function test() {
  // Use ts-node to run this script
  const outputService = new OutputService();
  const fileService = new FileService();

  // Create a dummy document
  const result = await fileService.createDocument('package.json', 'PDF', 100);
  if (!result.success) {
    console.error('Failed to create document');
    return;
  }
  const docId = result.data.id;

  // Test 1: Convert format
  const res1 = await outputService.process([docId], {
    format: 'DOCX', // OutputFormat.DOCX
    filename: 'test',
    pdfPageSize: 'A4',
    imageDpi: 300,
    protection: { enabled: false },
    mergeAsSingle: false
  });
  
  if (res1.success === false && res1.error.code === 'PDF_CONVERT_FAILED') {
    console.log('Test 1 Passed: Correctly blocked unsupported conversion');
  } else {
    console.log('Test 1 Failed:', res1);
  }
  
  // Test 2: Protection
  const res2 = await outputService.process([docId], {
    format: 'PDF',
    filename: 'test',
    pdfPageSize: 'A4',
    imageDpi: 300,
    protection: { enabled: true, ownerPassword: 'test' },
    mergeAsSingle: false
  });
  
  if (res2.success === false && res2.error.code === 'PDF_PROTECT_FAILED') {
    console.log('Test 2 Passed: Correctly blocked unsupported protection');
  } else {
    console.log('Test 2 Failed:', res2);
  }
  
  console.log('Done!');
}

test().catch(console.error);
