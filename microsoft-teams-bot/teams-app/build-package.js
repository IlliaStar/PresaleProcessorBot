const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const outPath = path.join(__dirname, 'presale-bot.zip');
const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Teams app package created: ${outPath} (${archive.pointer()} bytes)`);
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);

archive.file(path.join(__dirname, 'manifest.json'), { name: 'manifest.json' });
archive.file(path.join(__dirname, 'color.png'), { name: 'color.png' });
archive.file(path.join(__dirname, 'outline.png'), { name: 'outline.png' });

archive.finalize();
