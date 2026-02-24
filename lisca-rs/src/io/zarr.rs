use std::path::Path;
use std::sync::Arc;
use zarrs::array::{data_type, Array, ArrayBuilder};
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
    attrs: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<StoreArray, Box<dyn std::error::Error>> {
    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let mut b = ArrayBuilder::new(shape, chunks, data_type::uint16(), 0u16);
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
