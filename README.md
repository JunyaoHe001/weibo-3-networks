# Three Weibo Interaction Networks

An interactive, non-spatial atlas of three anonymised Weibo forwarding networks associated with the Bell and Drum Tower planning controversy in Beijing.

**Interactive atlas:** https://junyaohe001.github.io/weibo-3-networks/atlas/

## Networks

| Published network | Atlas layer | Nodes | Directed ties | Forwarding records | Published transitivity | Published average path length |
|---|---:|---:|---:|---:|---:|---:|
| Network I | Expert-led | 4,002 | 4,154 | 4,591 | 0.005 | 2.991 |
| Network II | Government-led | 165 | 200 | 294 | 0.045 | 2.033 |
| Network III | CSO-led | 846 | 1,036 | 1,479 | 0.029 | 4.063 |

The atlas reproduces the final network sizes reported in the published article. Repeated source–target records are aggregated as edge weights, and only the largest weakly connected component is retained for each network.

## Privacy and sanitisation

The original source workbooks contained Weibo account labels and post or forwarding text. These fields are **not included** in this repository.

- Original account names were replaced with anonymised structural codes: `A#` for the expert network, `B#` for the government network, and `C#` for the CSO network.
- Message, post, and forwarding text was removed.
- Invalid structural rows with unresolved endpoints were excluded.
- Tooltips expose only anonymised codes and network metrics.
- The public atlas does not provide any text search over original Weibo content.

See [`data/processed/sanitization_audit.csv`](data/processed/sanitization_audit.csv) for the row-level processing audit and [`DATA-USE.md`](DATA-USE.md) for the data-use notice.

## Repository structure

```text
atlas/
  index.html              Interactive canvas-based network atlas
  assets/                 CSS and JavaScript
  data/                   Web-ready JSON networks
data/
  sanitized-source/       Text-free structural copies of the six input tables
  processed/              Giant-component nodes, aggregated directed ties, and audit files
scripts/
  build_atlas_data.py     Rebuilds processed networks from the sanitised source CSV files
.github/workflows/
  pages.yml               GitHub Pages deployment
```

The atlas is implemented with a dependency-free HTML5 Canvas renderer. Layouts are precomputed with Graphviz `sfdp`; node communities are detected using weighted Louvain modularity on the undirected projection. Nodes can be searched by anonymised code, resized by degree measures, selected to expose local ties, and filtered by minimum edge weight.

## Rebuild

Python 3.10 or later and Graphviz are recommended.

```bash
python -m pip install -r requirements.txt
python scripts/build_atlas_data.py
python -m http.server 8000
```

Then open `http://localhost:8000/atlas/`.

## Citation

He, J., Lin, Y., Hooimeijer, P., & Monstadt, J. (2024). Measuring social network influence on power relations in collaborative planning: A case study of Beijing City, China. *Cities, 148*, 104866. https://doi.org/10.1016/j.cities.2024.104866

## Code licence

The website and processing code are released under the MIT License. The anonymised structural data are subject to the conditions in [`DATA-USE.md`](DATA-USE.md).
