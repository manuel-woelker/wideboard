use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{BoardElement, ElementId};

/// State for a single board.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Board {
    /// All board elements keyed by element id.
    elements: HashMap<ElementId, BoardElement>,
}

impl Board {
    /// Inserts or replaces an element with the same id.
    pub fn upsert_element(&mut self, element: BoardElement) -> Option<BoardElement> {
        self.elements.insert(element.id.clone(), element)
    }

    /// Gets an element by id.
    #[must_use]
    pub fn element(&self, element_id: &str) -> Option<&BoardElement> {
        self.elements.get(element_id)
    }

    /// Gets a mutable element by id.
    pub fn element_mut(&mut self, element_id: &str) -> Option<&mut BoardElement> {
        self.elements.get_mut(element_id)
    }

    /// Removes an element by id and returns it when present.
    pub fn remove_element(&mut self, element_id: &str) -> Option<BoardElement> {
        self.elements.remove(element_id)
    }

    /// Iterates over all elements in arbitrary order.
    pub fn elements(&self) -> impl Iterator<Item = &BoardElement> {
        self.elements.values()
    }
}
