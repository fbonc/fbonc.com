# Centroidal Voronoi tessellation

A Voronoi diagram in which every seed sits exactly at the centre of mass of its own cell.

This is a fixed point condition rather than a construction. Ordinarily a seed lies somewhere inside its cell but not at its centroid, and the two coincide only for particular arrangements, which turn out to be the ones that look good. A seed at its cell's centroid means every cell is balanced around its own site, which forces the seeds into an even, locally hexagonal packing with no clumps and no gaps.

Weighting is what makes it useful for images. If the centre of mass is computed with a density weight, so darker pixels count for more, cells shrink in dark regions and grow in light ones. The seeds end up dense where the image is dark and sparse where it is light, while the spacing stays locally even everywhere, which is precisely what stippling wants.

```
centroid = Σ ρ(p) · p  /  Σ ρ(p)
```

Lloyd's algorithm reaches this state by iteration, computing the diagram, moving each seed to its weighted centroid, and repeating. It converges reliably, though not to a unique answer, since different starting configurations settle into different equally good arrangements.

The distribution it produces is close to blue noise, meaning random in appearance but with locally even spacing, which is what independent random sampling fails to give.

See [[15_lloyd-relaxation|Lloyd relaxation]].
