package database

import (
	"os"
	"path/filepath"
	"testing"
)

// TestInitDBOpensWithTheProfile proves the store opens at all — a bare
// sql.Open("sqlite3") resolves only under cgo, so this package could not open a
// database in a CGO_ENABLED=0 image — and that it opens with the driver's
// durability profile.
//
// It reads PRAGMA back rather than asserting on the DSN: the spelling is exactly
// what differs between the driver's two backends, and each ignores the other's
// silently, so a string assertion passes on the build that ignores it.
func TestInitDBOpensWithTheProfile(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

	db, err := InitDB()
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	for _, c := range []struct{ pragma, want string }{
		{"journal_mode", "wal"},
		{"foreign_keys", "1"},
		{"busy_timeout", "10000"},
	} {
		var got string
		if err := db.QueryRow("PRAGMA " + c.pragma).Scan(&got); err != nil {
			t.Fatalf("PRAGMA %s: %v", c.pragma, err)
		}
		if got != c.want {
			t.Errorf("%s = %q, want %q — the DSN asked for it and the backend did not take it", c.pragma, got, c.want)
		}
	}
	if _, err := os.Stat(filepath.Join(".", dbPath)); err != nil {
		t.Errorf("no database at %s: %v", dbPath, err)
	}
}
