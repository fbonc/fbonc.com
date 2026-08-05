# Morton code

A one dimensional sort key built by interleaving the bits of two or more coordinates, also called a Z-order curve.

```
x = 0b1011
y = 0b0110
morton = 0b01101101      (y3 x3 y2 x2 y1 x1 y0 x0)
```

Sorting by that value traverses the plane in a recursive Z shaped pattern, covering one quadrant fully before moving to the next and recursing within each. Points close together in space almost always have close codes, because they share high order bits, which makes it a locality preserving key.

The interleave is done with a standard bit twiddling sequence, where each step doubles the spacing between bits and the masks clear the space being moved into.

```js
function part1by1(n) {
  n &= 0x0000ffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  n = (n | (n << 1)) & 0x55555555;
  return n;
}

const morton = (x, y) => ((part1by1(y) << 1) | part1by1(x)) >>> 0;
```

Two practical points. Inputs must be non negative integers, so positions are quantised first, typically onto a 16 bit range. And a 16 bit interleave fills 32 bits, where JavaScript's bitwise operators produce a signed result, so the `>>> 0` is required or half the codes sort as negatives.

The known weakness is that the curve makes long jumps at quadrant boundaries, so two physically adjacent points can have distant codes. The Hilbert curve avoids this and has better locality at the cost of a rotation step per level.

Uses beyond ordering include octree and spatial hash keys, and keeping a particle buffer in Morton order so that neighbouring invocations read neighbouring memory.

See [[16_spatial-ordering-and-matching|Spatial ordering and matching]].
