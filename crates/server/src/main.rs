use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(true)
        .init();

    let app = Router::new()
        .route("/ws", get(websocket_handler))
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

async fn websocket_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    info!("accepted websocket upgrade request");
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();

    while let Some(result) = receiver.next().await {
        match result {
            Ok(Message::Text(text)) => {
                info!(bytes = text.len(), body = %text, "echo request (text)");
                if sender.send(Message::Text(text)).await.is_err() {
                    warn!("websocket sender closed while echoing text");
                    break;
                }
            }
            Ok(Message::Binary(bytes)) => {
                info!(bytes = bytes.len(), "echo request (binary)");
                if sender.send(Message::Binary(bytes)).await.is_err() {
                    warn!("websocket sender closed while echoing binary message");
                    break;
                }
            }
            Ok(Message::Ping(payload)) => {
                if sender.send(Message::Pong(payload)).await.is_err() {
                    warn!("websocket sender closed while replying to ping");
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                info!("websocket close frame received");
                break;
            }
            Ok(Message::Pong(_)) => {}
            Err(_) => {
                error!("websocket receive error");
                break;
            }
        }
    }
}
