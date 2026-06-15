/// Canonical FileShot share URL: https://fileshot.io/f/{slug}#k={key}
pub const SHARE_BASE: &str = "https://fileshot.io/f";

pub fn build_share_url(file_id: &str, custom_link: Option<&str>, raw_key: Option<&str>) -> String {
    let slug = custom_link
        .filter(|s| !s.is_empty())
        .unwrap_or(file_id);
    let mut url = format!("{}/{}", SHARE_BASE, slug);
    if let Some(k) = raw_key.filter(|k| !k.is_empty()) {
        url.push_str(&format!("#k={}", k));
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_url_uses_f_path() {
        let u = build_share_url("abc123", None, Some("keypart"));
        assert_eq!(u, "https://fileshot.io/f/abc123#k=keypart");
    }

    #[test]
    fn share_url_prefers_custom_link() {
        let u = build_share_url("abc123", Some("my-slug"), None);
        assert_eq!(u, "https://fileshot.io/f/my-slug");
    }
}
