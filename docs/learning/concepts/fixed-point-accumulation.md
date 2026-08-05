# Fixed point accumulation

Summing floating point values with integer [[atomics]], because WGSL has no floating point atomics at all.

Multiply by a scale factor, round to an integer, accumulate with `atomicAdd`, and divide by the scale on read.

```wgsl
const SCALE: f32 = 4096.0;

atomicAdd(&acc.sumX, i32(pos.x * SCALE));
atomicAdd(&acc.count, 1u);

// on read
let mean = f32(atomicLoad(&acc.sumX)) / (SCALE * f32(atomicLoad(&acc.count)));
```

Choosing the scale is a real design decision with a silent failure mode, since `i32` saturates around 2.1 billion and `atomicAdd` wraps without warning. The budget is the number of contributors multiplied by the largest value each can add, and it should be computed explicitly rather than guessed.

Two rules follow. Normalise coordinates into a zero to one range before scaling, because feeding raw pixel values in is the usual cause of overflow. And pick the scale from the worst case, not by taste, remembering that a scale of 4096 already gives four decimal digits on a normalised coordinate, which is far more than a screen position needs.

The signature of overflow is a value that is correct at low counts and wrong at high ones, or a result that flies off when a region becomes dense.

Float atomics can be emulated with `atomicCompareExchangeWeak` over the bit pattern in a retry loop. It is slow and rarely worth it.

See [[09_parallel-patterns|Parallel patterns]] and [[15_lloyd-relaxation|Lloyd relaxation]].
