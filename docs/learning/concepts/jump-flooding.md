# Jump flooding

An algorithm that computes an approximate nearest seed labelling over a grid in a number of passes that depends only on the grid size, not on the number of seeds.

Each texel stores the coordinate of the nearest seed it currently knows about, starting as unknown everywhere except at the seeds themselves. Then a sequence of passes propagates that knowledge outward. In each pass, with step size `k`, every texel examines itself and its eight neighbours at offsets of `k`, and keeps whichever seed among them is nearest to itself.

The step sizes halve each pass, starting at half the grid width and ending at 1, so a 512 by 512 grid takes nine passes. The reason it works is that the distance between any two grid locations can be expressed as a sum of decreasing powers of two, which is its binary representation, so information can travel from any seed to any texel.

The cost is `pixels · log(width)`, entirely independent of the seed count, against `pixels · seeds` for the brute force approach. At 512 by 512 with 20000 seeds that is the difference between 21 million operations and 5 billion.

It is approximate. A texel can end up assigned to a seed that is not quite the nearest, at a rate typically well under one in ten thousand, and the errors occur on cell boundaries where two seeds are nearly equidistant, which makes them invisible in practice. Appending a final pass with `k = 1`, called JFA+1, cleans up most of them.

Each pass reads one texture and writes another, so [[ping-pong-buffering|ping-pong]] is mandatory, and the passes are separate dispatches because there is no synchronisation between workgroups within one.

The same computation yields a distance transform for free, since the distance to the winning seed is already computed.

See [[14_voronoi-and-jump-flooding|Voronoi and jump flooding]].
