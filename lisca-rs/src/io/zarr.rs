use std::path::Path;
use std::sync::Arc;

use zarrs::array::{data_type, Array, ArrayBuilder, ArraySubset, CodecOptions};
use zarrs::config::MetadataRetrieveVersion;
use zarrs::filesystem::FilesystemStore;
use zarrs::group::GroupBuilder;
use zarrs::storage::ReadableWritableListableStorageTraits;

pub type Store = Arc<FilesystemStore>;
pub type StoreArray = Array<dyn ReadableWritableListableStorageTraits>;

pub fn open_store(root: &Path) -> Result<Store, Box<dyn std::error::Error>> {
    Ok(Arc::new(FilesystemStore::new(root)?))
}

pub fn open_array(store: &Store, path: &str) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    Ok(Array::open_opt(st, path, &MetadataRetrieveVersion::V3)?)
}

pub fn read_chunk_u16(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    Ok(array.retrieve_chunk::<Vec<u16>>(chunk_indices)?)
}

pub fn store_chunk_u16(
    array: &Array<impl zarrs::storage::WritableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
    data: &[u16],
) -> Result<(), Box<dyn std::error::Error>> {
    array.store_chunk(chunk_indices, data)?;
    Ok(())
}

pub fn read_array_subset_u16(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    subset_start: &[u64],
    subset_shape: &[u64],
) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let subset = ArraySubset::new_with_start_shape(subset_start.to_vec(), subset_shape.to_vec())?;
    Ok(array.retrieve_array_subset_opt::<Vec<u16>>(&subset, &CodecOptions::default())?)
}

pub fn store_array_subset_u16(
    array: &Array<impl zarrs::storage::ReadableWritableStorageTraits + ?Sized + 'static>,
    subset_start: &[u64],
    subset_shape: &[u64],
    data: &[u16],
) -> Result<(), Box<dyn std::error::Error>> {
    let subset = ArraySubset::new_with_start_shape(subset_start.to_vec(), subset_shape.to_vec())?;
    array.store_array_subset(&subset, data)?;
    Ok(())
}

pub fn read_raw_frame_u16(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    t: u64,
    c: u64,
    z: u64,
) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let shape = array.shape();
    if shape.len() < 5 {
        return Err(std::io::Error::other("invalid raw array dimensionality").into());
    }
    read_array_subset_u16(array, &[t, c, z, 0, 0], &[1, 1, 1, shape[3], shape[4]])
}

pub fn store_raw_frame_u16(
    array: &Array<impl zarrs::storage::ReadableWritableStorageTraits + ?Sized + 'static>,
    t: u64,
    c: u64,
    z: u64,
    data: &[u16],
) -> Result<(), Box<dyn std::error::Error>> {
    let shape = array.shape();
    if shape.len() < 5 {
        return Err(std::io::Error::other("invalid raw array dimensionality").into());
    }
    store_array_subset_u16(
        array,
        &[t, c, z, 0, 0],
        &[1, 1, 1, shape[3], shape[4]],
        data,
    )
}

pub fn read_bg_value_u16(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    t: u64,
    c: u64,
    z: u64,
) -> Result<u16, Box<dyn std::error::Error>> {
    let data = read_array_subset_u16(array, &[t, c, z], &[1, 1, 1])?;
    data.into_iter()
        .next()
        .ok_or_else(|| std::io::Error::other("missing background value").into())
}

pub fn store_bg_value_u16(
    array: &Array<impl zarrs::storage::ReadableWritableStorageTraits + ?Sized + 'static>,
    t: u64,
    c: u64,
    z: u64,
    value: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    store_array_subset_u16(array, &[t, c, z], &[1, 1, 1], &[value])
}

pub fn read_mask_frame_u16(
    array: &Array<impl zarrs::storage::ReadableStorageTraits + ?Sized + 'static>,
    t: u64,
) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let shape = array.shape();
    if shape.len() < 3 {
        return Err(std::io::Error::other("invalid mask array dimensionality").into());
    }
    read_array_subset_u16(array, &[t, 0, 0], &[1, shape[1], shape[2]])
}

pub fn store_mask_frame_u16(
    array: &Array<impl zarrs::storage::ReadableWritableStorageTraits + ?Sized + 'static>,
    t: u64,
    data: &[u16],
) -> Result<(), Box<dyn std::error::Error>> {
    let shape = array.shape();
    if shape.len() < 3 {
        return Err(std::io::Error::other("invalid mask array dimensionality").into());
    }
    store_array_subset_u16(array, &[t, 0, 0], &[1, shape[1], shape[2]], data)
}

pub fn store_chunk_i32(
    array: &Array<impl zarrs::storage::WritableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
    data: &[i32],
) -> Result<(), Box<dyn std::error::Error>> {
    array.store_chunk(chunk_indices, data)?;
    Ok(())
}

pub fn store_chunk_u8(
    array: &Array<impl zarrs::storage::WritableStorageTraits + ?Sized + 'static>,
    chunk_indices: &[u64],
    data: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    array.store_chunk(chunk_indices, data)?;
    Ok(())
}

pub fn ensure_groups(store: &Store, paths: &[&str]) -> Result<(), Box<dyn std::error::Error>> {
    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let root = GroupBuilder::new().build(st.clone(), "/")?;
    root.store_metadata()?;
    for p in paths {
        let g = GroupBuilder::new().build(st.clone(), p)?;
        g.store_metadata()?;
    }
    Ok(())
}

pub fn create_array_u16(
    store: &Store,
    path: &str,
    shape: Vec<u64>,
    chunks: Vec<u64>,
    shards: Option<Vec<u64>>,
    attrs: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let chunk_grid = shards.clone().unwrap_or_else(|| chunks.clone());
    let mut b = ArrayBuilder::new(shape, chunk_grid, data_type::uint16(), 0u16);
    if let Some(shards) = shards {
        if shards != chunks {
            b.subchunk_shape(chunks);
        }
    }
    if let Some(a) = attrs {
        b.attributes(a);
    }
    let arr = b.build(st, path)?;
    arr.store_metadata()?;
    Ok(arr)
}

pub fn create_array_i32(
    store: &Store,
    path: &str,
    shape: Vec<u64>,
    chunks: Vec<u64>,
) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let b = ArrayBuilder::new(shape, chunks, data_type::int32(), 0i32);
    let arr = b.build(st, path)?;
    arr.store_metadata()?;
    Ok(arr)
}

pub fn create_array_u8(
    store: &Store,
    path: &str,
    shape: Vec<u64>,
    chunks: Vec<u64>,
) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let b = ArrayBuilder::new(shape, chunks, data_type::uint8(), 0u8);
    let arr = b.build(st, path)?;
    arr.store_metadata()?;
    Ok(arr)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_store_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("lisca-zarr-{name}-{nanos}"))
    }

    #[test]
    fn subset_helpers_round_trip_sharded_arrays() {
        let root = temp_store_path("sharded");
        fs::create_dir_all(&root).expect("create temp store dir");

        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let store = open_store(&root)?;
            ensure_groups(&store, &["/roi"])?;

            let raw = create_array_u16(
                &store,
                "/roi/7/raw",
                vec![70, 2, 1, 4, 5],
                vec![1, 1, 1, 4, 5],
                Some(vec![64, 2, 1, 4, 5]),
                None,
            )?;
            let bg = create_array_u16(
                &store,
                "/roi/7/background",
                vec![70, 2, 1],
                vec![1, 1, 1],
                Some(vec![70, 2, 1]),
                None,
            )?;
            let mask = create_array_u16(
                &store,
                "/roi/7/mask",
                vec![70, 4, 5],
                vec![1, 4, 5],
                Some(vec![64, 4, 5]),
                None,
            )?;

            let raw_frame_a: Vec<u16> = (0..20).collect();
            let raw_frame_b: Vec<u16> = (100..120).collect();
            store_raw_frame_u16(&raw, 0, 0, 0, &raw_frame_a)?;
            store_raw_frame_u16(&raw, 65, 1, 0, &raw_frame_b)?;
            store_bg_value_u16(&bg, 65, 1, 0, 321)?;
            let mask_frame: Vec<u16> = (200..220).collect();
            store_mask_frame_u16(&mask, 65, &mask_frame)?;

            assert_eq!(read_raw_frame_u16(&raw, 0, 0, 0)?, raw_frame_a);
            assert_eq!(read_raw_frame_u16(&raw, 65, 1, 0)?, raw_frame_b);
            assert_eq!(read_bg_value_u16(&bg, 65, 1, 0)?, 321);
            assert_eq!(read_mask_frame_u16(&mask, 65)?, mask_frame);
            Ok(())
        })();

        let _ = fs::remove_dir_all(&root);
        result.expect("sharded subset helpers should round-trip");
    }

    #[test]
    fn subset_helpers_work_for_unsharded_arrays() {
        let root = temp_store_path("unsharded");
        fs::create_dir_all(&root).expect("create temp store dir");

        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let store = open_store(&root)?;
            ensure_groups(&store, &["/roi"])?;

            let raw = create_array_u16(
                &store,
                "/roi/9/raw",
                vec![2, 1, 1, 3, 4],
                vec![1, 1, 1, 3, 4],
                None,
                None,
            )?;
            let bg = create_array_u16(
                &store,
                "/roi/9/background",
                vec![2, 1, 1],
                vec![1, 1, 1],
                None,
                None,
            )?;
            let mask = create_array_u16(
                &store,
                "/roi/9/mask",
                vec![2, 3, 4],
                vec![1, 3, 4],
                None,
                None,
            )?;

            let raw_frame: Vec<u16> = (10..22).collect();
            let mask_frame: Vec<u16> = (30..42).collect();
            store_raw_frame_u16(&raw, 1, 0, 0, &raw_frame)?;
            store_bg_value_u16(&bg, 1, 0, 0, 77)?;
            store_mask_frame_u16(&mask, 1, &mask_frame)?;

            assert_eq!(read_raw_frame_u16(&raw, 1, 0, 0)?, raw_frame);
            assert_eq!(read_bg_value_u16(&bg, 1, 0, 0)?, 77);
            assert_eq!(read_mask_frame_u16(&mask, 1)?, mask_frame);
            Ok(())
        })();

        let _ = fs::remove_dir_all(&root);
        result.expect("subset helpers should work for unsharded arrays");
    }
}
