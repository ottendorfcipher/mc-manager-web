//! Small security helpers shared across handlers.

/// Constant-time byte-slice equality.
///
/// A naive `==` short-circuits on the first differing byte, leaking (via
/// response timing) how far an attacker's guess matched a secret. This inspects
/// every byte regardless of where the first difference falls. Length is
/// compared first — for fixed-length tokens that reveals nothing useful.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn equal_slices_match() {
        assert!(constant_time_eq(b"secret", b"secret"));
    }

    #[test]
    fn different_content_does_not_match() {
        assert!(!constant_time_eq(b"secret", b"SECRET"));
    }

    #[test]
    fn different_length_does_not_match() {
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn empty_slices_match() {
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn one_empty_does_not_match_nonempty() {
        assert!(!constant_time_eq(b"", b"x"));
        assert!(!constant_time_eq(b"x", b""));
    }

    #[test]
    fn single_bit_difference_does_not_match() {
        assert!(!constant_time_eq(b"\x00", b"\x01"));
    }
}
