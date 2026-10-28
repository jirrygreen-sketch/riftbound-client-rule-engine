mod card_images;

use std::sync::Arc;

#[tauri::command]
fn exit_client(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(card_images::PrefetchState::default()))
        .register_asynchronous_uri_scheme_protocol(card_images::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(card_images::handle_request(&app, &request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            exit_client,
            card_images::card_image_cache_ids,
            card_images::prefetch_card_images,
            card_images::cancel_card_image_prefetch
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Riftbound desktop client");
}
