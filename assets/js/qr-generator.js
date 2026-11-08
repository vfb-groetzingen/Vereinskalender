// Lokaler QR-Encoder (Byte-Modus, Fehlerkorrektur M, Version 1-8).
// Keine externen Dienste oder statischen QR-Dateien erforderlich.
const RS_BLOCKS_M = {
  1: [16],
  2: [28],
  3: [44],
  4: [32, 32],
  5: [43, 43],
  6: [27, 27, 27, 27],
  7: [31, 31, 31, 31],
  8: [38, 38, 39, 39]
};
const ECC_CODEWORDS_PER_BLOCK_M = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16, 7: 18, 8: 22 };
const ALIGNMENT_POSITIONS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26],
  5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42]
};

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 0; i < 8; i++) {
    if (y & 1) z ^= x;
    y >>>= 1;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return z;
}

function rsRemainder(data, degree) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      next[j] ^= generator[j];
      next[j + 1] ^= gfMultiply(generator[j], root);
    }
    generator = next;
    root = gfMultiply(root, 2);
  }
  const work = [...data, ...Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = work[i];
    if (factor) {
      for (let j = 0; j < generator.length; j++) work[i + j] ^= gfMultiply(generator[j], factor);
    }
  }
  return work.slice(data.length);
}

function makeCodewords(bytes, version) {
  const dataLengths = RS_BLOCKS_M[version];
  const capacityBits = dataLengths.reduce((sum, n) => sum + n, 0) * 8;
  const bits = [];
  appendBits(bits, 0b0100, 4); // Byte mode
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  for (let i = 0; i < Math.min(4, capacityBits - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  for (let pad = 0; data.length < capacityBits / 8; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);

  const blocks = [];
  let offset = 0;
  for (const length of dataLengths) {
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: block, ecc: rsRemainder(block, ECC_CODEWORDS_PER_BLOCK_M[version]) });
  }
  const out = [];
  const maxData = Math.max(...dataLengths);
  const maxEcc = blocks[0].ecc.length;
  for (let i = 0; i < maxData; i++) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < maxEcc; i++) for (const block of blocks) out.push(block.ecc[i]);
  return out;
}

function bchRemainder(value, polynomial) {
  const degree = (n) => n === 0 ? 0 : 32 - Math.clz32(n);
  let remainder = value;
  while (degree(remainder) >= degree(polynomial)) remainder ^= polynomial << (degree(remainder) - degree(polynomial));
  return remainder;
}

function setFinder(matrix, row, col) {
  const size = matrix.length;
  for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
    const y = row + r, x = col + c;
    if (y < 0 || y >= size || x < 0 || x >= size) continue;
    matrix[y][x] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
      (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
      (r >= 2 && r <= 4 && c >= 2 && c <= 4);
  }
}

function makeMatrix(version, codewords) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  setFinder(matrix, 0, 0);
  setFinder(matrix, size - 7, 0);
  setFinder(matrix, 0, size - 7);

  const positions = ALIGNMENT_POSITIONS[version];
  for (const row of positions) for (const col of positions) {
    if (matrix[row][col] !== null) continue;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
      matrix[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) === 2 || (r === 0 && c === 0);
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
  }

  if (version >= 7) {
    const versionBits = (version << 12) | bchRemainder(version << 12, 0x1f25);
    for (let i = 0; i < 18; i++) {
      const bit = ((versionBits >>> i) & 1) !== 0;
      matrix[Math.floor(i / 3)][i % 3 + size - 11] = bit;
      matrix[i % 3 + size - 11][Math.floor(i / 3)] = bit;
    }
  }

  // Format information: error correction M (format bits 00), mask pattern 0.
  const formatData = 0;
  const formatBits = ((formatData << 10) | bchRemainder(formatData << 10, 0x537)) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >>> i) & 1) !== 0;
    const y = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    matrix[y][8] = bit;
    const x = i < 8 ? size - i - 1 : i < 9 ? 7 : 14 - i;
    matrix[8][x] = bit;
  }
  matrix[size - 8][8] = true;

  let bitIndex = 0;
  let row = size - 1;
  let direction = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (const c of [col, col - 1]) {
        if (matrix[row][c] !== null) continue;
        const byte = codewords[Math.floor(bitIndex / 8)] || 0;
        let dark = bitIndex < codewords.length * 8 && ((byte >>> (7 - bitIndex % 8)) & 1) !== 0;
        if ((row + c) % 2 === 0) dark = !dark;
        matrix[row][c] = dark;
        bitIndex++;
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
  return matrix.map((line) => line.map(Boolean));
}

export function createQrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  if (bytes.length > 255) throw new Error('Der Link ist zu lang für den QR-Code.');
  for (let version = 1; version <= 8; version++) {
    const capacity = RS_BLOCKS_M[version].reduce((sum, n) => sum + n, 0) * 8;
    if (12 + bytes.length * 8 <= capacity) return makeMatrix(version, makeCodewords(bytes, version));
  }
  throw new Error('Der Link ist zu lang für den QR-Code (maximal 152 Byte).');
}

export function qrMatrixToSvgDataUrl(matrix, quietZone = 4) {
  if (!Array.isArray(matrix) || !matrix.length || !matrix.every((row) => row.length === matrix.length)) {
    throw new Error('Ungültige QR-Matrix.');
  }
  const size = matrix.length + quietZone * 2;
  let path = '';
  for (let r = 0; r < matrix.length; r++) for (let c = 0; c < matrix.length; c++) {
    if (matrix[r][c]) path += `M${c + quietZone},${r + quietZone}h1v1h-1z`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function qrMatrixToPngDataUrl(matrix, modulePixels = 36, quietZone = 4) {
  if (typeof document === 'undefined') throw new Error('PNG-Erzeugung ist nur im Browser möglich.');
  const modules = matrix.length + quietZone * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = modules * modulePixels;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Die PNG-Erzeugung ist in diesem Browser nicht verfügbar.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let r = 0; r < matrix.length; r++) for (let c = 0; c < matrix.length; c++) {
    if (matrix[r][c]) context.fillRect((c + quietZone) * modulePixels, (r + quietZone) * modulePixels, modulePixels, modulePixels);
  }
  return canvas.toDataURL('image/png');
}
