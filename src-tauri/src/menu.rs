use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let name = app.package_info().name.clone();
  let about = AboutMetadataBuilder::new()
    .name(Some(name.clone()))
    .version(Some(env!("CARGO_PKG_VERSION")))
    .build();

  let app_menu = SubmenuBuilder::new(app, name)
    .about(Some(about))
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .separator()
    .quit()
    .build()?;

  let edit_menu = SubmenuBuilder::new(app, "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()?;

  let window_menu = SubmenuBuilder::new(app, "Window")
    .minimize()
    .maximize()
    .build()?;

  MenuBuilder::new(app)
    .items(&[&app_menu, &edit_menu, &window_menu])
    .build()
}
