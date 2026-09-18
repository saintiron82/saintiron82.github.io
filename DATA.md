# Attribution

## The brain

`brain.bin` is derived from the **MaleCNS v1.0** connectome.

- **Source:** [male-cns.janelia.org](https://male-cns.janelia.org/) · [downloads](https://male-cns.janelia.org/download/)
- **Licence:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Credit:** the FlyEM Project Team at HHMI Janelia, the Cambridge Drosophila
  Connectomics Group, the MRC Laboratory of Molecular Biology, Google Research,
  and everyone who acquired, reconstructed, proofread and annotated the dataset.
  No endorsement by any of them is implied.

### Changes made

The full release is 166,700 neurons and 25.5M connections. This file is a
measured subset of it:

- **Kept:** every photoreceptor, and every L1 cell with a hex coordinate.
  7,858 neurons, 7,107 edges. Everything else was cut after measuring that
  cutting cost nothing — see the README.
- **Threshold:** connections with fewer than 3 synapses dropped before the cut.
- **Signs:** GABA and glutamate negative, everything else positive. This is a
  **modelling assumption**, not measurement: it comes from neurotransmitter
  *prediction*, and unclear cases are treated as excitatory. In this subset
  every edge ends up negative, because photoreceptors are histaminergic.
- **Format:** CSR by target neuron, `uint32` indices and `float32` signed
  weights, plus the retina's screen positions and the readout indices.
- **Not included:** anything outside that subset, and any timing information —
  the connectome has none. The 12 steps and the 18 ms a step are choices made
  here, not values from the data.

This is a rate model. It is not a spiking simulation, not a biophysical
reconstruction, and not a model of biological learning.
