use std::{
    collections::HashMap,
    io,
    io::Cursor,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, mpsc};
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use tracing_subscriber::{EnvFilter, fmt};
use zip::ZipArchive;

const BOARD_SAVE_DIRECTORY: &str = "boards";
const BOARD_SAVE_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WireBoardState {
    elements: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
struct BoardEntry {
    state: WireBoardState,
    modified: bool,
}

#[derive(Debug, Clone)]
struct EmbeddedAsset {
    bytes: Vec<u8>,
    content_type: &'static str,
}

#[derive(Debug, Clone, Default)]
struct EmbeddedAssets {
    files: HashMap<String, EmbeddedAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireBoardElementUpsert {
    element: serde_json::Value,
    index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WireBoardElementChanges {
    upserted: Vec<WireBoardElementUpsert>,
    #[serde(rename = "removedIds")]
    removed_ids: Vec<String>,
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
    #[serde(rename = "update_board_elements")]
    UpdateBoardElements {
        #[serde(rename = "boardId")]
        board_id: String,
        changes: WireBoardElementChanges,
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
    #[serde(rename = "board_elements_updated")]
    BoardElementsUpdated {
        #[serde(rename = "boardId")]
        board_id: String,
        changes: WireBoardElementChanges,
    },
}

#[derive(Clone)]
struct AppState {
    clients: Arc<RwLock<HashMap<u64, mpsc::UnboundedSender<Message>>>>,
    boards: Arc<RwLock<HashMap<String, BoardEntry>>>,
    assets: Arc<EmbeddedAssets>,
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

    tokio::fs::create_dir_all(BOARD_SAVE_DIRECTORY)
        .await
        .expect("failed to create board persistence directory");

    let assets = load_embedded_assets_from_current_executable().await;

    let app_state = AppState {
        clients: Arc::new(RwLock::new(HashMap::new())),
        boards: Arc::new(RwLock::new(HashMap::new())),
        assets: Arc::new(assets),
        next_client_id: Arc::new(AtomicU64::new(1)),
    };

    spawn_board_persistence_task(app_state.clone());

    let app = Router::new()
        .route("/ws", get(websocket_handler))
        .route("/", get(serve_index_asset))
        .route("/{*path}", get(serve_embedded_asset))
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

async fn serve_index_asset(State(state): State<AppState>) -> Response {
    serve_asset_path("index.html", &state.assets)
}

async fn serve_embedded_asset(Path(path): Path<String>, State(state): State<AppState>) -> Response {
    serve_asset_path(path.as_str(), &state.assets)
}

fn serve_asset_path(path: &str, assets: &EmbeddedAssets) -> Response {
    let normalized = path.trim_start_matches('/');
    if let Some(asset) = assets.files.get(normalized) {
        return response_with_asset(StatusCode::OK, asset);
    }

    // Support SPA client-side routes by serving index.html when the requested path
    // does not look like a static file.
    if !normalized.contains('.') {
        if let Some(index_asset) = assets.files.get("index.html") {
            return response_with_asset(StatusCode::OK, index_asset);
        }
    }

    (StatusCode::NOT_FOUND, "Asset not found").into_response()
}

fn response_with_asset(status: StatusCode, asset: &EmbeddedAsset) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static(asset.content_type),
    );

    (status, headers, asset.bytes.clone()).into_response()
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

fn read_element_id(element: &serde_json::Value) -> Option<&str> {
    element.get("id").and_then(serde_json::Value::as_str)
}

fn content_type_for_path(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn find_appended_zip_start(binary_bytes: &[u8]) -> Option<usize> {
    const EOCD_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x05, 0x06];
    if binary_bytes.len() < 22 {
        return None;
    }

    // The EOCD record is at most 65,557 bytes from EOF (22 + u16::MAX comment).
    let search_start = binary_bytes.len().saturating_sub(65_557);

    for eocd_pos in (search_start..=binary_bytes.len() - 22).rev() {
        if binary_bytes[eocd_pos..eocd_pos + 4] != EOCD_SIGNATURE {
            continue;
        }

        let comment_length =
            u16::from_le_bytes([binary_bytes[eocd_pos + 20], binary_bytes[eocd_pos + 21]]) as usize;
        let expected_end = eocd_pos + 22 + comment_length;
        if expected_end != binary_bytes.len() {
            continue;
        }

        let central_directory_size = u32::from_le_bytes([
            binary_bytes[eocd_pos + 12],
            binary_bytes[eocd_pos + 13],
            binary_bytes[eocd_pos + 14],
            binary_bytes[eocd_pos + 15],
        ]) as usize;
        let central_directory_offset = u32::from_le_bytes([
            binary_bytes[eocd_pos + 16],
            binary_bytes[eocd_pos + 17],
            binary_bytes[eocd_pos + 18],
            binary_bytes[eocd_pos + 19],
        ]) as usize;

        let start_delta = central_directory_size.checked_add(central_directory_offset)?;
        let zip_start = eocd_pos.checked_sub(start_delta)?;
        return Some(zip_start);
    }

    None
}

async fn load_embedded_assets_from_current_executable() -> EmbeddedAssets {
    let executable_path = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            warn!(%error, "failed to determine current executable path");
            return EmbeddedAssets::default();
        }
    };

    let binary_bytes = match tokio::fs::read(&executable_path).await {
        Ok(bytes) => bytes,
        Err(error) => {
            warn!(path = %executable_path.display(), %error, "failed to read executable bytes");
            return EmbeddedAssets::default();
        }
    };

    let Some(zip_start) = find_appended_zip_start(&binary_bytes) else {
        warn!("no appended ui zip payload detected in executable");
        return EmbeddedAssets::default();
    };

    let zip_bytes = &binary_bytes[zip_start..];
    let reader = Cursor::new(zip_bytes);
    let mut archive = match ZipArchive::new(reader) {
        Ok(archive) => archive,
        Err(error) => {
            warn!(%error, "failed to parse appended zip payload");
            return EmbeddedAssets::default();
        }
    };

    let mut files = HashMap::new();
    for index in 0..archive.len() {
        let mut file = match archive.by_index(index) {
            Ok(file) => file,
            Err(error) => {
                warn!(index, %error, "failed to read file entry from embedded zip");
                continue;
            }
        };

        if file.is_dir() {
            continue;
        }

        let name = file.name().trim_start_matches('/').to_string();
        let mut content = Vec::with_capacity(file.size() as usize);
        if let Err(error) = io::copy(&mut file, &mut content) {
            warn!(entry = %name, %error, "failed to read embedded asset bytes");
            continue;
        }

        files.insert(
            name.clone(),
            EmbeddedAsset {
                bytes: content,
                content_type: content_type_for_path(&name),
            },
        );
    }

    info!(
        asset_count = files.len(),
        "loaded embedded ui assets from executable zip payload"
    );
    EmbeddedAssets { files }
}

fn make_filename_safe_board_id(board_id: &str) -> String {
    let mut safe: String = board_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();

    if safe.is_empty() {
        safe = "board".to_string();
    }

    format!("{safe}.json")
}

fn board_file_path(board_id: &str) -> PathBuf {
    let mut path = PathBuf::from(BOARD_SAVE_DIRECTORY);
    path.push(make_filename_safe_board_id(board_id));
    path
}

async fn load_board_state_from_disk(board_id: &str) -> Option<WireBoardState> {
    let file_path = board_file_path(board_id);
    let bytes = match tokio::fs::read(&file_path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
        Err(error) => {
            warn!(board_id, path = %file_path.display(), %error, "failed to read board save file");
            return None;
        }
    };

    match serde_json::from_slice::<WireBoardState>(&bytes) {
        Ok(state) => Some(state),
        Err(error) => {
            warn!(board_id, path = %file_path.display(), %error, "failed to deserialize board save file");
            None
        }
    }
}

async fn save_board_state_to_disk(board_id: &str, board_state: &WireBoardState) -> io::Result<()> {
    let file_path = board_file_path(board_id);
    let content = serde_json::to_vec_pretty(board_state)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    tokio::fs::write(&file_path, content).await
}

async fn ensure_board_loaded(
    app_state: &AppState,
    board_id: &str,
    initial_state: Option<WireBoardState>,
) -> WireBoardState {
    {
        let boards = app_state.boards.read().await;
        if let Some(entry) = boards.get(board_id) {
            return entry.state.clone();
        }
    }

    let disk_state = load_board_state_from_disk(board_id).await;

    let mut boards = app_state.boards.write().await;
    if let Some(entry) = boards.get(board_id) {
        return entry.state.clone();
    }

    let resolved_state = disk_state
        .or(initial_state)
        .unwrap_or_else(WireBoardState::default);
    boards.insert(
        board_id.to_string(),
        BoardEntry {
            state: resolved_state.clone(),
            modified: false,
        },
    );

    resolved_state
}

fn apply_board_element_changes(state: &mut WireBoardState, changes: &WireBoardElementChanges) {
    if !changes.removed_ids.is_empty() {
        state.elements.retain(|element| {
            let Some(id) = read_element_id(element) else {
                return true;
            };
            !changes
                .removed_ids
                .iter()
                .any(|removed_id| removed_id == id)
        });
    }

    for upsert in &changes.upserted {
        let Some(element_id) = read_element_id(&upsert.element) else {
            warn!("skipping board element upsert without string id");
            continue;
        };

        state.elements.retain(|element| {
            let Some(existing_id) = read_element_id(element) else {
                return true;
            };
            existing_id != element_id
        });

        let insertion_index = upsert.index.min(state.elements.len());
        state
            .elements
            .insert(insertion_index, upsert.element.clone());
    }
}

fn spawn_board_persistence_task(app_state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(BOARD_SAVE_INTERVAL);
        loop {
            interval.tick().await;
            persist_modified_boards(&app_state).await;
        }
    });
}

async fn persist_modified_boards(app_state: &AppState) {
    let dirty_snapshots = {
        let mut boards = app_state.boards.write().await;
        boards
            .iter_mut()
            .filter_map(|(board_id, entry)| {
                if !entry.modified {
                    return None;
                }

                entry.modified = false;
                Some((board_id.clone(), entry.state.clone()))
            })
            .collect::<Vec<_>>()
    };

    for (board_id, board_state) in dirty_snapshots {
        if let Err(error) = save_board_state_to_disk(&board_id, &board_state).await {
            error!(board_id, %error, "failed to persist board state");
            let mut boards = app_state.boards.write().await;
            if let Some(entry) = boards.get_mut(&board_id) {
                entry.modified = true;
            }
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
                        let board_state =
                            ensure_board_loaded(&state, &board_id, initial_state).await;

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
                    ClientMessage::UpdateBoardElements { board_id, changes } => {
                        let _ = ensure_board_loaded(&state, &board_id, None).await;
                        {
                            let mut boards = state.boards.write().await;
                            let Some(board_entry) = boards.get_mut(&board_id) else {
                                warn!(board_id, "board missing after load attempt during update");
                                continue;
                            };
                            apply_board_element_changes(&mut board_entry.state, &changes);
                            board_entry.modified = true;
                        }

                        let server_message =
                            ServerMessage::BoardElementsUpdated { board_id, changes };
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
