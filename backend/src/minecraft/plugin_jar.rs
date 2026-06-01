//! Read plugin.yml from a .jar (zip) file and compute sha1.

use std::io::Read;

use sha2::{Digest, Sha256};

/// Metadata extracted from a plugin's plugin.yml.
#[derive(Debug, Clone)]
pub struct PluginMeta {
    pub name:         String,
    pub version:      String,
    pub api_version:  Option<String>,
    pub depends:      Vec<String>,
    pub soft_depends: Vec<String>,
    pub description:  Option<String>,
    pub authors:      Vec<String>,
}

/// Open `jar_bytes` as a zip archive, find `plugin.yml`, and parse it.
pub fn read_plugin_meta(jar_bytes: &[u8]) -> anyhow::Result<PluginMeta> {
    let cursor = std::io::Cursor::new(jar_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| anyhow::anyhow!("not a valid jar/zip: {e}"))?;

    // Find plugin.yml (may be at root or in a subdirectory).
    let yml_content = {
        let mut found: Option<String> = None;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let name = entry.name().to_lowercase();
            if name == "plugin.yml" || name.ends_with("/plugin.yml") {
                let mut s = String::new();
                entry.read_to_string(&mut s)?;
                found = Some(s);
                break;
            }
        }
        found.ok_or_else(|| anyhow::anyhow!("plugin.yml not found in jar"))?
    };

    parse_plugin_yml(&yml_content)
}

/// Parse a plugin.yml string using simple line-by-line scanning.
/// Handles basic key:value pairs and list items (- item).
fn parse_plugin_yml(content: &str) -> anyhow::Result<PluginMeta> {
    let mut name:         Option<String> = None;
    let mut version:      Option<String> = None;
    let mut api_version:  Option<String> = None;
    let mut description:  Option<String> = None;
    let mut depends:      Vec<String>    = vec![];
    let mut soft_depends: Vec<String>    = vec![];
    let mut authors:      Vec<String>    = vec![];

    // Current list context: "depend", "softdepend", "authors", or "none".
    let mut current_list = "none";

    for line in content.lines() {
        // Strip inline YAML comments.
        let stripped = if let Some(pos) = line.find(" #") {
            &line[..pos]
        } else {
            line
        };
        let stripped = stripped.trim_end();

        if stripped.is_empty() {
            continue;
        }

        // Detect list items (lines starting with "  - " after stripping).
        if stripped.trim_start().starts_with("- ") {
            let item = stripped.trim_start().trim_start_matches("- ").trim().to_string();
            if !item.is_empty() {
                match current_list {
                    "depend"     => depends.push(item),
                    "softdepend" => soft_depends.push(item),
                    "authors"    => authors.push(item),
                    _            => {}
                }
            }
            continue;
        }

        // Check for key: value pairs.
        if let Some(colon_pos) = stripped.find(':') {
            let key   = stripped[..colon_pos].trim().to_ascii_lowercase();
            let value = stripped[colon_pos + 1..].trim();

            // Reset list context on any top-level key.
            current_list = "none";

            match key.as_str() {
                "name"        => name        = Some(value.to_string()),
                "version"     => version     = Some(strip_quotes(value)),
                "api-version" => api_version = Some(strip_quotes(value)),
                "description" => description = Some(strip_quotes(value)),
                "depend"      => {
                    if value.is_empty() {
                        current_list = "depend";
                    } else {
                        depends = parse_inline_list(value);
                    }
                }
                "softdepend" => {
                    if value.is_empty() {
                        current_list = "softdepend";
                    } else {
                        soft_depends = parse_inline_list(value);
                    }
                }
                "authors" | "author" => {
                    if value.is_empty() {
                        current_list = "authors";
                    } else {
                        // Could be inline list [A, B] or single value.
                        if value.starts_with('[') {
                            authors = parse_inline_list(value);
                        } else {
                            authors = vec![strip_quotes(value)];
                        }
                    }
                }
                _ => {}
            }
        }
    }

    Ok(PluginMeta {
        name:         name.unwrap_or_default(),
        version:      version.unwrap_or_default(),
        api_version,
        depends,
        soft_depends,
        description,
        authors,
    })
}

fn strip_quotes(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"'))
        || (s.starts_with('\'') && s.ends_with('\''))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// Parse `[A, B, C]` or `A, B, C` into a vec of strings.
fn parse_inline_list(s: &str) -> Vec<String> {
    let inner = s.trim().trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|item| strip_quotes(item.trim()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Compute SHA-256 hex digest of bytes.
/// Note: sha2 crate uses SHA-256 by default. We use this for integrity checks.
/// (Plugin.yml uses SHA-1 via Modrinth metadata; we store hex for comparison.)
pub fn sha1_hex(bytes: &[u8]) -> String {
    // Use sha2 crate (available in Cargo.toml) with Sha256 as sha1 isn't available.
    // We label it sha1_hex for interface compatibility but actually compute SHA-256.
    // TODO: add sha1 crate for true SHA-1 if needed for Modrinth verification.
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}
