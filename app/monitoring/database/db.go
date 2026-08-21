package database

import (
	"database/sql"

	"github.com/hanzoai/sqlite"
)

type DB struct {
	*sql.DB
}

// dbPath is where this service keeps its metrics.
const dbPath = "./monitoring.db"

func InitDB() (*DB, error) {
	// The driver builds the DSN and applies the profile. A bare open takes no
	// pragmas at all: foreign keys off on either build, and a busy timeout that
	// depends on which backend is linked — so concurrent writers here would meet
	// SQLITE_BUSY rather than wait.
	db, err := sql.Open("sqlite", sqlite.PragmaDSN(dbPath, sqlite.DefaultPragmas))
	if err != nil {
		return nil, err
	}

	// Create metrics table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS server_metrics (
			timestamp TEXT PRIMARY KEY,
			cpu REAL,
			cpu_model TEXT,
			cpu_cores INTEGER,
			cpu_physical_cores INTEGER,
			cpu_speed REAL,
			os TEXT,
			distro TEXT,
			kernel TEXT,
			arch TEXT,
			mem_used REAL,
			mem_used_gb REAL,
			mem_total REAL,
			uptime INTEGER,
			disk_used REAL,
			total_disk REAL,
			network_in REAL,
			network_out REAL
		)
	`)
	if err != nil {
		return nil, err
	}

	return &DB{db}, nil
}
