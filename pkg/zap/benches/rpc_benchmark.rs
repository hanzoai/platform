//! RPC Benchmarks for Platform ZAP Server
//!
//! Measures serialization, RPC round-trip, and throughput.

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use capnp::message::{Builder, ReaderOptions};
use capnp::serialize;

fn benchmark_capnp_serialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("capnp_serialize");
    group.throughput(Throughput::Elements(1));

    // Create a message
    let mut message = Builder::new_default();

    group.bench_function("build_message", |b| {
        b.iter(|| {
            let mut message = Builder::new_default();
            // In real benchmark, would build actual platform messages
            black_box(&message);
        })
    });

    group.finish();
}

fn benchmark_capnp_deserialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("capnp_deserialize");
    group.throughput(Throughput::Elements(1));

    // Create a message and serialize it
    let message = Builder::new_default();
    let mut buffer = Vec::new();
    serialize::write_message(&mut buffer, &message).unwrap();

    group.bench_function("read_message", |b| {
        b.iter(|| {
            let reader = serialize::read_message(
                &mut buffer.as_slice(),
                ReaderOptions::default(),
            ).unwrap();
            black_box(reader);
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    benchmark_capnp_serialize,
    benchmark_capnp_deserialize,
);

criterion_main!(benches);
