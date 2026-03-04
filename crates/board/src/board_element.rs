use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{ElementId, PropertyValue};

/// A board element with explicit frame information and dynamic properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoardElement {
    /// Unique identifier for this element within a board.
    pub id: ElementId,
    /// The element's top-left x-coordinate.
    pub x: f32,
    /// The element's top-left y-coordinate.
    pub y: f32,
    /// The element's width.
    pub width: f32,
    /// The element's height.
    pub height: f32,
    /// Flexible properties for element-specific metadata and settings.
    pub properties: HashMap<String, PropertyValue>,
}

impl BoardElement {
    /// Creates a new element with an empty property map.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            id: id.into(),
            x,
            y,
            width,
            height,
            properties: HashMap::new(),
        }
    }
}
