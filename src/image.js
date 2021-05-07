const { createCanvas } = require('canvas')
const chroma = require('chroma-js')
const logger = require('./logger')

module.exports = function() {
  const PADDING = 5;
  const BORDER = 20;
  const RADIUS = 13;

  const COLUMNS = 56;
  const ROWS = 2016 / COLUMNS;
  const DOT = 8;
  const DOT_GAP = 1;

  const FONT_SIZE = 11;

  const COLORS_ORANGE = chroma.scale(['#fa9f1e','#ee7a21']).colors(DOT, format='num');
  const COLORS_BLUE = chroma.scale(['#40a2f3','#1c77d0']).colors(DOT, format='num');
  const COLORS_GREY = chroma.scale(['#303030','#282828']).colors(DOT, format='num');

  this.createImage = function(taproot, percentage) {
    var background = 0xff300a24;
    
    var width = getWidth();
    var height = getHeight();

    var WIDTH = width + PADDING + PADDING + BORDER + BORDER;
    var HEIGHT = height + PADDING + PADDING + BORDER + BORDER;
    
    if (WIDTH / 16 > HEIGHT / 9) {
      HEIGHT = Math.round(WIDTH / 16 * 9);
    } else {
      WIDTH = Math.round(HEIGHT / 9 * 16);
    }

    if (HEIGHT % 2 == 1) {
      HEIGHT++;
    }
    if (WIDTH % 2 == 1) {
      WIDTH++;
    }

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    
    var buffer = new ArrayBuffer(imageData.data.length);
    var pixels = new Uint32Array(buffer);

    pixels.fill(0);

    var ox = (WIDTH - width) >> 1;
    var oy = (HEIGHT - height) >> 1;

    drawBackground(pixels, background, WIDTH, width, height, ox, oy);

    drawDots(pixels, taproot, WIDTH, ox, oy);

    imageData.data.set(new Uint8ClampedArray(buffer));
    ctx.putImageData(imageData, 0, 0);
    
    ctx.imageSmoothingEnabled = false;
    
    ctx.font = `bold ${FONT_SIZE}px DejaVu Sans Mono`;
    ctx.textBaseline = 'bottom';
    var w = ctx.measureText(' ').width;
    
    ctx.textAlign = 'left'
    
    ctx.fillStyle = `#289f69`;
    ctx.fillText('bitcoin@thundroid', ox, oy);

    ctx.fillStyle = '#12488b';
    ctx.fillText('~', ox + (w * 18), oy);

    ctx.font = `${FONT_SIZE}px DejaVu Sans Mono`;
    ctx.fillStyle = '#ffffff';  
    ctx.fillText(': $ ./taproot.sh', ox + (w * 17), oy);
    
    ctx.textBaseline = 'top';
    ctx.fillText(percentage, ox, oy + height);

    ctx.textAlign = 'right'
    ctx.fillText('@mutatrum', ox + width, oy + height);

    return canvas.toBuffer();
  }

  function getHeight() {
    return (ROWS * DOT) + ((ROWS - 1) * DOT_GAP);
  }

  function getWidth() {
    return (COLUMNS * DOT) + ((COLUMNS - 1) * DOT_GAP);
  }

  function drawBackground(pixels, color, WIDTH, width, height, ox, oy) {
    ox -= BORDER;
    oy -= BORDER;
    width += BORDER << 1;
    height += BORDER << 1;
    
    var circle = getCircle();

    var x = ox + ((oy + RADIUS) * WIDTH);
    for (var i = 0; i <= height - RADIUS - RADIUS; i++) {
      pixels.fill(color, x, x + width);
      x += WIDTH;
    }
    var x = ox + RADIUS + (oy * WIDTH);
    var x2 = (height - RADIUS - 1) * WIDTH;
    for (var i = 0; i <= RADIUS; i++) {
      var c1 = circle[RADIUS - i];
      pixels.fill(color, x - c1, x + width + c1 - RADIUS - RADIUS);
      var c2 = circle[i];
      pixels.fill(color, x + x2 - c2, x + x2 + width + c2 - RADIUS - RADIUS);
      x += WIDTH;
    }
  }

  function drawDots(pixels, taproot, WIDTH, ox, oy) {
    var ax = 0, ay = 0, bx = 0, by = 0;
    
    for (var i = 0; i < 2016; i++) {

      var x = ox + (bx * (DOT + DOT_GAP));
      var y = oy + (by * (DOT + DOT_GAP));
      
      var colors = i < taproot.length ? (taproot[i].hasTaprootSignal ? COLORS_BLUE : COLORS_ORANGE) : COLORS_GREY;
      dot(pixels, WIDTH, x, y, colors);
      
      bx++;
      if (bx == COLUMNS) {
        by++;
        bx = 0;
      }
    }
  }

  function getCircle() {
    var circle = new Array(RADIUS);
    circle[0] = RADIUS;

    var x = 0;
    var y = RADIUS;
    var d = 3 - (2 * RADIUS);
  
    while(x <= y) {
      if(d <= 0) {
        d = d + (4 * x) + 6;
      } else {
        d = d + (4 * x) - (4 * y) + 10;
        y--;
      }
      x++;

      circle[x] = y;
      circle[y] = x;
    }

    return circle;
  }

  function dot(pixels, WIDTH, x, y, colors) {
    var p = (y * WIDTH) + x;
    for (var i = 0; i < DOT; i++) {
      pixels.fill(0xFF000000 + Math.round(colors[i]) , p, p + DOT);
      p += WIDTH;
    }
  }
}
