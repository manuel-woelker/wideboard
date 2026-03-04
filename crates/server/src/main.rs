use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, mpsc};
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use tracing_subscriber::{EnvFilter, fmt};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WireBoardState {
    elements: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "mouse_moved")]
    MouseMoved {
        #[serde(rename = "participantId")]
        participant_id: String,
        name: String,
        #[serde(rename = "boardX")]
        board_x: f64,
        #[serde(rename = "boardY")]
        board_y: f64,
    },
    #[serde(rename = "request_board_state")]
    RequestBoardState {
        #[serde(rename = "boardId")]
        board_id: String,
        #[serde(rename = "initialState")]
        initial_state: Option<WireBoardState>,
    },
    #[serde(rename = "update_board_state")]
    UpdateBoardState {
        #[serde(rename = "boardId")]
        board_id: String,
        state: WireBoardState,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "mouse_moved")]
    MouseMoved {
        #[serde(rename = "participantId")]
        participant_id: String,
        name: String,
        #[serde(rename = "boardX")]
        board_x: f64,
        #[serde(rename = "boardY")]
        board_y: f64,
    },
    #[serde(rename = "board_state")]
    BoardState {
        #[serde(rename = "boardId")]
        board_id: String,
        state: WireBoardState,
    },
    #[serde(rename = "board_state_updated")]
    BoardStateUpdated {
        #[serde(rename = "boardId")]
        board_id: String,
        state: WireBoardState,
    },
}

#[derive(Clone)]
struct AppState {
    clients: Arc<RwLock<HashMap<u64, mpsc::UnboundedSender<Message>>>>,
    boards: Arc<RwLock<HashMap<String, WireBoardState>>>,
    next_client_id: Arc<AtomicU64>,
}

#[tokio::main]
async fn main() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(true)
        .init();

    let app_state = AppState {
        clients: Arc::new(RwLock::new(HashMap::new())),
        boards: Arc::new(RwLock::new(HashMap::new())),
        next_client_id: Arc::new(AtomicU64::new(1)),
    };

    let app = Router::new()
        .route("/ws", get(websocket_handler))
        .with_state(app_state)
        .layer(CorsLayer::permissive());

    let bind_address = "0.0.0.0:3000";
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("failed to bind TCP listener on 0.0.0.0:3000");
    info!(
        address = bind_address,
        endpoint = "/ws",
        "server startup complete"
    );

    axum::serve(listener, app)
        .await
        .expect("server error while serving axum application");
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let client_id = state.next_client_id.fetch_add(1, Ordering::Relaxed);
    info!(client_id, "accepted websocket upgrade request");
    ws.on_upgrade(move |socket| handle_socket(socket, state, client_id))
}

fn encode_message(message: &ServerMessage) -> Option<Message> {
    match serde_json::to_string(message) {
        Ok(payload) => Some(Message::Text(payload.into())),
        Err(error) => {
            error!(%error, "failed to serialize outbound websocket payload");
            None
        }
    }
}

async fn broadcast_to_peers(state: &AppState, sender_id: u64, message: &ServerMessage) {
    let Some(encoded_message) = encode_message(message) else {
        return;
    };

    let peers = state.clients.read().await;
    for (&peer_id, peer_sender) in peers.iter() {
        if peer_id == sender_id {
            continue;
        }

        if peer_sender.send(encoded_message.clone()).is_err() {
            warn!(peer_id, "failed to queue broadcast message for peer");
        }
    }
}

async fn handle_socket(socket: WebSocket, state: AppState, client_id: u64) {
    let (mut sender, mut receiver) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<Message>();

    state
        .clients
        .write()
        .await
        .insert(client_id, outbound_tx.clone());

    let send_task = tokio::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            if sender.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(socket_event) = receiver.next().await {
        match socket_event {
            Ok(Message::Text(text)) => {
                let payload = text.to_string();
                info!(
                    client_id,
                    bytes = payload.len(),
                    "received text websocket message"
                );

                let client_message = match serde_json::from_str::<ClientMessage>(&payload) {
                    Ok(message) => message,
                    Err(error) => {
                        warn!(client_id, %error, "ignoring malformed websocket json payload");
                        continue;
                    }
                };

                match client_message {
                    ClientMessage::MouseMoved {
                        participant_id,
                        name,
                        board_x,
                        board_y,
                    } => {
                        let server_message = ServerMessage::MouseMoved {
                            participant_id,
                            name,
                            board_x,
                            board_y,
                        };
                        broadcast_to_peers(&state, client_id, &server_message).await;
                    }
                    ClientMessage::RequestBoardState {
                        board_id,
                        initial_state,
                    } => {
                        let board_state = {
                            let mut boards = state.boards.write().await;
                            let entry = boards
                                .entry(board_id.clone())
                                .or_insert_with(|| initial_state.unwrap_or_default());
                            entry.clone()
                        };

                        let server_message = ServerMessage::BoardState {
                            board_id,
                            state: board_state,
                        };
                        let Some(encoded_message) = encode_message(&server_message) else {
                            continue;
                        };

                        if outbound_tx.send(encoded_message).is_err() {
                            warn!(client_id, "failed to queue board state response for client");
                            break;
                        }
                    }
                    ClientMessage::UpdateBoardState {
                        board_id,
                        state: next_state,
                    } => {
                        {
                            let mut boards = state.boards.write().await;
                            boards.insert(board_id.clone(), next_state.clone());
                        }

                        let server_message = ServerMessage::BoardStateUpdated {
                            board_id,
                            state: next_state,
                        };
                        broadcast_to_peers(&state, client_id, &server_message).await;
                    }
                }
            }
            Ok(Message::Binary(_)) => {
                warn!(client_id, "ignoring binary websocket message");
            }
            Ok(Message::Ping(payload)) => {
                let peers = state.clients.read().await;
                if let Some(self_sender) = peers.get(&client_id) {
                    if self_sender.send(Message::Pong(payload)).is_err() {
                        warn!(client_id, "failed to queue pong response for client");
                        break;
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!(client_id, "websocket close frame received");
                break;
            }
            Ok(Message::Pong(_)) => {}
            Err(_) => {
                error!(client_id, "websocket receive error");
                break;
            }
        }
    }

    state.clients.write().await.remove(&client_id);
    send_task.abort();
    info!(client_id, "websocket connection closed");
}
