use serde::{Deserialize, Serialize};

/// Primitive value representation for dynamic element properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PropertyValue {
    /// UTF-8 string value.
    String(String),
    /// Signed 64-bit integer value.
    Integer(i64),
    /// 64-bit floating-point value.
    Float(f64),
    /// Boolean value.
    Boolean(bool),
}
