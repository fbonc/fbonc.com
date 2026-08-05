# VAULT_CONVENTIONS.md

Vault conventions

## Structure

* This repository is an Obsidian vault containing a knowledge base, software documentation, and research notes.
* Organize content by subject matter. Use judgment when a note could fit more than one topic.
* Keep the hierarchy shallow: `root/topic/subtopic/`.
* Every directory, including the root, has its own ordered main sequence.
* Keep configuration files, licenses, manifests, and similar technical files in their conventional locations.
* Store assets in an `assets/` directory within the relevant topic when practical. Use judgment when another location is clearer.

## Main sequences

* Main-sequence files are navigation notes, entry points, or notes forming a conceptual progression.
* Name them with contiguous two-digit prefixes:

  * `00_overview.md`
  * `01_rendering-pipeline.md`
  * `02_shader-system.md`
* `00_*.md` is the directory entry point.
* When inserting or removing a sequence note, renumber the sequence so it remains contiguous.
* Parent notes should stay high-level: summarize the topic, establish context, and link to lower-level notes rather than duplicating their details.
* Root notes should usually link to top-level topics, but may link deeper when that is genuinely clearer.

## Auxiliary notes

* Keep auxiliary and atomic notes in the same directory as the main sequence.
* Auxiliary notes should cover one narrow concept, procedure, implementation detail, reference, or research finding.
* Use unique reverse-alphabet prefixes so they sort after the main sequence:

  * `zz_buffer-layout.md`
  * `zy_coordinate-systems.md`
  * `zx_reference-links.md`
* Assign prefixes in descending order: `zz_`, `zy_`, `zx_`, and so on.
* Split a note when it mixes abstraction levels, covers multiple independent concepts, or contains a section that can stand on its own.

## Naming and links

* Use lowercase filenames.
* Use an underscore after the ordering prefix and hyphens within the descriptive name: `01_rendering-pipeline.md`.
* Use the same lowercase, hyphenated style for directories.
* Use Obsidian wikilinks for internal links.
* Rely on Obsidian backlinks for reverse navigation; do not add explicit parent links unless they improve clarity.
* Keep one canonical copy of each concept. Never duplicate content across directories; link to the canonical note instead.

## Writing style

* Keep notes concise, direct, and focused on one level of abstraction.
* Preserve enough context for the note to remain understandable.
* Prefer short summaries and annotated links over repeated explanations.
* Remove redundant prose, empty sections, and boilerplate.
* Avoid YAML frontmatter and metadata unless they solve a concrete need.

## Maintenance

* Preserve meaning and technical accuracy over structural uniformity.
* Before moving, renaming, splitting, merging, substantially rewriting, or deleting notes, ask the user.
* Before making structural changes, inspect related notes and links.
* After approved moves or renames, update all affected wikilinks and verify that no links were broken.
* Use judgment for ambiguous categorization, but never duplicate content.
* Favor the smallest structure that keeps navigation and abstraction clear.
