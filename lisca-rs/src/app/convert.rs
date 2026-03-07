use std::fs;
use std::io::BufWriter;
use std::path::Path;

use tiff::encoder::{colortype::Gray16, TiffEncoder};

use crate::cli::commands::convert::ConvertArgs;
use crate::common::slices;
use crate::io::nd2::Nd2File;

pub fn run(
    args: ConvertArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let output_path = Path::new(&args.output);

    let mut nd2 = Nd2File::open(&args.input)?;
    let sizes = nd2.sizes()?;

    let n_pos = *sizes.get("P").unwrap_or(&1);
    let n_time = *sizes.get("T").unwrap_or(&1);
    let n_chan = *sizes.get("C").unwrap_or(&1);
    let n_z = *sizes.get("Z").unwrap_or(&1);
    let height = *sizes.get("Y").unwrap_or(&1);
    let width = *sizes.get("X").unwrap_or(&1);

    let pos_indices = slices::parse_slice_string(&args.pos, n_pos)?;
    let time_indices = slices::parse_slice_string(&args.time, n_time)?;

    let total = pos_indices.len() * time_indices.len() * n_chan * n_z;
    fs::create_dir_all(output_path)?;

    let mut done: usize = 0;
    for &p_idx in &pos_indices {
        let pos_dir = output_path.join(format!("Pos{}", p_idx));
        fs::create_dir_all(&pos_dir)?;

        let time_map_path = pos_dir.join("time_map.csv");
        let mut csv = BufWriter::new(fs::File::create(&time_map_path)?);
        use std::io::Write;
        writeln!(csv, "t,t_real")?;
        for (t_new, &t_orig) in time_indices.iter().enumerate() {
            writeln!(csv, "{},{}", t_new, t_orig)?;
        }
        csv.flush()?;

        for (t_new, &t_orig) in time_indices.iter().enumerate() {
            for c in 0..n_chan {
                for z in 0..n_z {
                    let channel_data = nd2.read_frame_2d(p_idx, t_orig, c, z)?;
                    let fname = format!(
                        "img_channel{:03}_position{:03}_time{:09}_z{:03}.tif",
                        c, p_idx, t_new, z
                    );
                    let tiff_path = pos_dir.join(&fname);
                    let file = fs::File::create(&tiff_path)?;
                    let mut writer = BufWriter::new(file);
                    let mut encoder = TiffEncoder::new(&mut writer)?;
                    encoder.write_image::<Gray16>(width as u32, height as u32, &channel_data)?;

                    done += 1;
                    if total > 0 {
                        progress(
                            done as f64 / total as f64,
                            &format!("Writing TIFFs {}/{}", done, total),
                        );
                    }
                }
            }
        }
    }

    progress(1.0, &format!("Wrote {}", output_path.display()));
    Ok(())
}
