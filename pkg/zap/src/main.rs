//! Platform ZAP Server
//!
//! Zero-copy Agent Protocol server for Hanzo Platform.
//! Exposes cloud infrastructure control via Cap'n Proto RPC.
//!
//! Usage:
//!     platform-zap [OPTIONS]
//!
//! Options:
//!     -c, --config <FILE>    Configuration file path
//!     -l, --listen <ADDR>    Listen address (default: 0.0.0.0)
//!     -p, --port <PORT>      Port number (default: 9998)
//!     --trpc-url <URL>       Platform tRPC API URL
//!     --generate-token       Generate a test token and exit
//!     -v, --verbose          Enable verbose logging
//!     -h, --help             Print help

use clap::{Arg, Command};
use platform_zap::{config::Config, server::Server};
use std::path::PathBuf;
use tracing::{error, info, Level};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse command line arguments
    let matches = Command::new("platform-zap")
        .version(platform_zap::VERSION)
        .author("Hanzo AI <dev@hanzo.ai>")
        .about("Zero-copy Agent Protocol server for Hanzo Platform")
        .arg(
            Arg::new("config")
                .short('c')
                .long("config")
                .value_name("FILE")
                .help("Configuration file path"),
        )
        .arg(
            Arg::new("listen")
                .short('l')
                .long("listen")
                .value_name("ADDR")
                .help("Listen address"),
        )
        .arg(
            Arg::new("port")
                .short('p')
                .long("port")
                .value_name("PORT")
                .help("Port number"),
        )
        .arg(
            Arg::new("trpc-url")
                .long("trpc-url")
                .value_name("URL")
                .help("Platform tRPC API URL"),
        )
        .arg(
            Arg::new("generate-token")
                .long("generate-token")
                .help("Generate a test token and exit")
                .action(clap::ArgAction::SetTrue),
        )
        .arg(
            Arg::new("subject")
                .long("subject")
                .value_name("SUBJECT")
                .help("Subject for generated token")
                .default_value("test-user"),
        )
        .arg(
            Arg::new("org")
                .long("org")
                .value_name("ORG_ID")
                .help("Organization ID for generated token")
                .default_value("test-org"),
        )
        .arg(
            Arg::new("verbose")
                .short('v')
                .long("verbose")
                .help("Enable verbose logging")
                .action(clap::ArgAction::SetTrue),
        )
        .get_matches();

    // Initialize logging
    let log_level = if matches.get_flag("verbose") {
        Level::DEBUG
    } else {
        Level::INFO
    };

    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(
            EnvFilter::from_default_env()
                .add_directive(format!("platform_zap={}", log_level).parse().unwrap())
                .add_directive("capnp_rpc=warn".parse().unwrap()),
        )
        .init();

    // Load configuration
    let mut config = if let Some(config_path) = matches.get_one::<String>("config") {
        let path = PathBuf::from(config_path);
        info!(path = %path.display(), "Loading configuration from file");
        Config::load(&path)?
    } else {
        info!("Loading configuration from environment");
        Config::from_env()?
    };

    // Apply command line overrides
    if let Some(listen) = matches.get_one::<String>("listen") {
        config.server.listen = listen.clone();
    }
    if let Some(port) = matches.get_one::<String>("port") {
        config.server.port = port.parse()?;
    }
    if let Some(url) = matches.get_one::<String>("trpc-url") {
        config.trpc.base_url = url.clone();
    }

    // Create server
    let server = Server::new(config);

    // Handle generate-token mode
    if matches.get_flag("generate-token") {
        let subject = matches.get_one::<String>("subject").unwrap();
        let org = matches.get_one::<String>("org").unwrap();

        match server.generate_token(subject, org) {
            Ok(token) => {
                println!("Generated token:\n{}", token);
                return Ok(());
            }
            Err(e) => {
                error!(error = %e, "Failed to generate token");
                return Err(e.into());
            }
        }
    }

    // Print startup banner
    println!(
        r#"
  ____  _       _    __                        _____    _    ____
 |  _ \| | __ _| |_ / _| ___  _ __ _ __ ___   |__  /   / \  |  _ \
 | |_) | |/ _` | __| |_ / _ \| '__| '_ ` _ \    / /   / _ \ | |_) |
 |  __/| | (_| | |_|  _| (_) | |  | | | | | |  / /__ / ___ \|  __/
 |_|   |_|\__,_|\__|_|  \___/|_|  |_| |_| |_| /____/_/   \_\_|

  Version: {}
  Protocol: {}
"#,
        platform_zap::VERSION,
        platform_zap::PROTOCOL_VERSION
    );

    // Run server
    if let Err(e) = server.run().await {
        error!(error = %e, "Server error");
        return Err(e.into());
    }

    Ok(())
}
