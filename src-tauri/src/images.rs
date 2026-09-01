use crate::queue::{self, JobContext};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ExtendedColorType, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTransformOptions {
    pub(crate) format: String,
    pub(crate) max_width: Option<u32>,
    pub(crate) max_height: Option<u32>,
    pub(crate) quality: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTransformResult {
    source: String,
    output: String,
    width: u32,
    height: u32,
    format: String,
}

fn normalized_format(value: &str) -> Result<(&'static str, ImageFormat), String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Ok(("jpg", ImageFormat::Jpeg)),
        "png" => Ok(("png", ImageFormat::Png)),
        "webp" => Ok(("webp", ImageFormat::WebP)),
        _ => Err("Scout currently converts images to JPG, PNG, or WebP".into()),
    }
}

fn available_output(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let direct = directory.join(format!("{stem}.{extension}"));
    if !direct.exists() {
        return direct;
    }
    for number in 2..10_000 {
        let candidate = directory.join(format!("{stem} {number}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.{extension}", std::process::id()))
}

fn resize_image(image: DynamicImage, max_width: Option<u32>, max_height: Option<u32>) -> DynamicImage {
    let (width, height) = image.dimensions();
    let max_width = max_width.filter(|value| *value > 0).unwrap_or(width);
    let max_height = max_height.filter(|value| *value > 0).unwrap_or(height);
    if width <= max_width && height <= max_height {
        return image;
    }
    image.thumbnail(max_width, max_height)
}

fn write_image(image: &DynamicImage, output: &Path, format: ImageFormat, quality: u8) -> Result<(), String> {
    let mut file = File::create(output).map_err(|error| error.to_string())?;
    if format == ImageFormat::Jpeg {
        let rgb = image.to_rgb8();
        let mut encoder = JpegEncoder::new_with_quality(&mut file, quality.clamp(1, 100));
        encoder
            .encode(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
            .map_err(|error| error.to_string())
    } else {
        image.write_to(&mut file, format).map_err(|error| error.to_string())
    }
}

pub(crate) fn transform_blocking(
    paths: Vec<String>,
    destination: String,
    options: ImageTransformOptions,
    context: Option<&JobContext>,
) -> Result<Vec<ImageTransformResult>, String> {
    if paths.is_empty() {
        return Err("Choose at least one image".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_dir() {
        return Err("Image output destination is not a directory".into());
    }
    let (extension, format) = normalized_format(&options.format)?;
    let quality = options.quality.unwrap_or(88).clamp(1, 100);
    let total = paths.len();
    let mut results = Vec::with_capacity(total);

    for (index, raw_path) in paths.into_iter().enumerate() {
        if context.is_some_and(JobContext::cancelled) {
            return Err("Image conversion cancelled".into());
        }
        if let Some(context) = context {
            context.progress(
                Some(index as f64 / total as f64),
                Some(format!("Converting {}/{} images", index + 1, total)),
            );
        }
        let source = PathBuf::from(&raw_path);
        if !source.is_file() {
            return Err(format!("Image source is not a file: {}", source.display()));
        }
        let image = image::open(&source)
            .map_err(|error| format!("Could not decode {}: {error}", source.display()))?;
        if context.is_some_and(JobContext::cancelled) {
            return Err("Image conversion cancelled".into());
        }
        let image = resize_image(image, options.max_width, options.max_height);
        let stem = source
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Image".to_string());
        let output = available_output(&destination, &stem, extension);
        if let Err(error) = write_image(&image, &output, format, quality) {
            let _ = std::fs::remove_file(&output);
            return Err(format!("Could not write {}: {error}", output.display()));
        }
        if context.is_some_and(JobContext::cancelled) {
            let _ = std::fs::remove_file(&output);
            return Err("Image conversion cancelled".into());
        }
        let (width, height) = image.dimensions();
        results.push(ImageTransformResult {
            source: raw_path,
            output: output.to_string_lossy().into_owned(),
            width,
            height,
            format: extension.to_string(),
        });
    }

    if let Some(context) = context {
        context.progress(Some(1.0), Some(format!("Converted {} images", results.len())));
    }
    Ok(results)
}

#[tauri::command]
pub async fn transform_images(
    paths: Vec<String>,
    destination: String,
    options: ImageTransformOptions,
) -> Result<Vec<ImageTransformResult>, String> {
    tauri::async_runtime::spawn_blocking(move || transform_blocking(paths, destination, options, None))
        .await
        .map_err(|error| format!("Image conversion task failed: {error}"))?
}

#[tauri::command]
pub fn enqueue_image_transform(
    app: AppHandle,
    paths: Vec<String>,
    destination: String,
    options: ImageTransformOptions,
) -> Result<u64, String> {
    if paths.is_empty() {
        return Err("Choose at least one image".into());
    }
    let label = if paths.len() == 1 {
        let name = Path::new(&paths[0])
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "image".to_string());
        format!("Convert image · {name}")
    } else {
        format!("Convert {} images", paths.len())
    };
    Ok(queue::enqueue_blocking(app, "image", label, move |context| {
        transform_blocking(paths, destination, options, Some(&context))
    }))
}
