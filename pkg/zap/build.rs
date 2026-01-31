//! Build script for platform-zap
//!
//! Compiles Cap'n Proto schema files into Rust code.

fn main() {
    // Rerun if schema changes
    println!("cargo:rerun-if-changed=schema/platform.capnp");

    // Compile Cap'n Proto schema
    capnpc::CompilerCommand::new()
        .src_prefix("schema")
        .file("schema/platform.capnp")
        .run()
        .expect("Failed to compile Cap'n Proto schema");
}
