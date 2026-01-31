//! Example ZAP Client
//!
//! Demonstrates how to connect to the Platform ZAP server
//! and perform basic operations.
//!
//! Run with:
//!     cargo run --example client -- --token <TOKEN> --org <ORG_ID>

use capnp_rpc::{rpc_twoparty_capnp, twoparty, RpcSystem};
use std::net::ToSocketAddrs;
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncReadCompatExt;

// Include generated code
mod platform_capnp {
    include!(concat!(env!("OUT_DIR"), "/platform_capnp.rs"));
}

use platform_capnp::platform;

#[derive(Debug)]
struct Args {
    host: String,
    port: u16,
    token: String,
    org_id: String,
}

fn parse_args() -> Args {
    let args: Vec<String> = std::env::args().collect();
    let mut host = "localhost".to_string();
    let mut port = 9998u16;
    let mut token = String::new();
    let mut org_id = String::new();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--host" => {
                host = args.get(i + 1).cloned().unwrap_or_default();
                i += 2;
            }
            "--port" => {
                port = args.get(i + 1).and_then(|p| p.parse().ok()).unwrap_or(9998);
                i += 2;
            }
            "--token" => {
                token = args.get(i + 1).cloned().unwrap_or_default();
                i += 2;
            }
            "--org" => {
                org_id = args.get(i + 1).cloned().unwrap_or_default();
                i += 2;
            }
            _ => i += 1,
        }
    }

    if token.is_empty() || org_id.is_empty() {
        eprintln!("Usage: client --token <TOKEN> --org <ORG_ID> [--host <HOST>] [--port <PORT>]");
        std::process::exit(1);
    }

    Args {
        host,
        port,
        token,
        org_id,
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args();

    println!("Connecting to {}:{}...", args.host, args.port);

    // Connect to server
    let addr = format!("{}:{}", args.host, args.port)
        .to_socket_addrs()?
        .next()
        .ok_or("Could not resolve address")?;

    let stream = TcpStream::connect(&addr).await?;
    stream.set_nodelay(true)?;

    println!("Connected! Initializing RPC...");

    let (reader, writer) = stream.into_split();
    let reader = reader.compat();
    let writer = writer.compat_write();

    let rpc_network = twoparty::VatNetwork::new(
        reader,
        writer,
        rpc_twoparty_capnp::Side::Client,
        Default::default(),
    );

    let mut rpc_system = RpcSystem::new(Box::new(rpc_network), None);
    let platform: platform::Client = rpc_system.bootstrap(rpc_twoparty_capnp::Side::Server);

    // Spawn RPC system
    tokio::spawn(rpc_system);

    // Initialize connection
    println!("Sending Hello...");
    let mut init_request = platform.initialize_request();
    {
        let mut hello = init_request.get().init_hello();
        hello.set_client_id("example-client");
        hello.set_client_version("0.1.0");
        hello.set_token(&args.token);
        hello.set_organization_id(&args.org_id);
    }

    let init_response = init_request.send().promise.await?;
    let welcome = init_response.get()?.get_welcome()?;

    println!("Received Welcome!");
    println!("  Server version: {}", welcome.get_server_version()?);
    println!("  Protocol version: {}", welcome.get_protocol_version()?);
    println!("  Session ID: {}", welcome.get_session_id()?);
    println!("  Capabilities: {:?}", {
        let caps = welcome.get_capabilities()?;
        (0..caps.len())
            .map(|i| caps.get(i).unwrap_or("").to_string())
            .collect::<Vec<_>>()
    });

    // Ping test
    println!("\nPing test...");
    let ping_start = std::time::Instant::now();
    let ping_response = platform.ping_request().send().promise.await?;
    let ping_duration = ping_start.elapsed();

    let ping = ping_response.get()?;
    println!("  Latency: {:?}", ping_duration);
    println!("  Server time: {}", ping.get_server_time());

    // Get tool catalog
    println!("\nFetching tool catalog...");
    let catalog_response = platform.get_catalog_request().send().promise.await?;
    let tools = catalog_response.get()?.get_tools()?;

    println!("Available tools ({}):", tools.len());
    for i in 0..tools.len() {
        let tool = tools.get(i);
        println!(
            "  - {} [{}] ({})",
            tool.get_name()?,
            tool.get_scope()?,
            tool.get_effect()?
        );
    }

    // Get scaling interface
    println!("\nGetting Scaling interface...");
    let scaling_response = platform.scaling_request().send().promise.await?;
    let _scaling = scaling_response.get()?.get_scaling()?;
    println!("  Got Scaling capability!");

    // Get cloud interface
    println!("\nGetting Cloud interface...");
    let cloud_response = platform.cloud_request().send().promise.await?;
    let cloud = cloud_response.get()?.get_cloud()?;
    println!("  Got Cloud capability!");

    // List providers
    println!("\nListing cloud providers...");
    let providers_response = cloud.list_providers_request().send().promise.await?;
    let providers = providers_response.get()?.get_providers()?;

    if providers.len() == 0 {
        println!("  No providers configured");
    } else {
        for i in 0..providers.len() {
            let provider = providers.get(i);
            println!(
                "  - {} ({}) - {}",
                provider.get_name()?,
                provider.get_provider()?,
                provider.get_status()?
            );
        }
    }

    println!("\nDone!");

    Ok(())
}
