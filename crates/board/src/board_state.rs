use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{Board, BoardId};

/// Aggregate state for all boards in the application.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BoardState {
    /// All known boards keyed by their unique id.
    boards: HashMap<BoardId, Board>,
}

impl BoardState {
    /// Creates an empty board state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates an empty board when the id is not present and returns it.
    pub fn ensure_board(&mut self, board_id: impl Into<BoardId>) -> &mut Board {
        self.boards.entry(board_id.into()).or_default()
    }

    /// Gets a board by id.
    #[must_use]
    pub fn board(&self, board_id: &str) -> Option<&Board> {
        self.boards.get(board_id)
    }

    /// Gets a mutable board by id.
    pub fn board_mut(&mut self, board_id: &str) -> Option<&mut Board> {
        self.boards.get_mut(board_id)
    }

    /// Removes a board by id and returns it when present.
    pub fn remove_board(&mut self, board_id: &str) -> Option<Board> {
        self.boards.remove(board_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BoardElement, PropertyValue};

    #[test]
    fn supports_multiple_boards_with_unique_ids() {
        let mut state = BoardState::new();

        state.ensure_board("board-a");
        state.ensure_board("board-b");

        assert!(state.board("board-a").is_some());
        assert!(state.board("board-b").is_some());
        assert!(state.board("board-c").is_none());
    }

    #[test]
    fn stores_element_geometry_explicitly() {
        let mut state = BoardState::new();
        let board = state.ensure_board("canvas");

        board.upsert_element(BoardElement::new("e-1", 10.0, 20.0, 300.0, 160.0));

        let element = board.element("e-1").expect("element e-1 should exist");
        assert_eq!(element.x, 10.0);
        assert_eq!(element.y, 20.0);
        assert_eq!(element.width, 300.0);
        assert_eq!(element.height, 160.0);
    }

    #[test]
    fn stores_additional_properties_in_map() {
        let mut state = BoardState::new();
        let board = state.ensure_board("canvas");

        let mut element = BoardElement::new("e-note", 0.0, 0.0, 240.0, 120.0);
        element.properties.insert(
            "title".to_string(),
            PropertyValue::String("Todo".to_string()),
        );
        element
            .properties
            .insert("pinned".to_string(), PropertyValue::Boolean(true));
        board.upsert_element(element);

        let stored = board
            .element("e-note")
            .expect("element e-note should exist");
        assert_eq!(
            stored.properties.get("title"),
            Some(&PropertyValue::String("Todo".to_string()))
        );
        assert_eq!(
            stored.properties.get("pinned"),
            Some(&PropertyValue::Boolean(true))
        );
    }
}
