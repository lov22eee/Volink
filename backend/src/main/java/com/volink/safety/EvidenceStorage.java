package com.volink.safety;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Private evidence files. Today they live in a server directory that is never served directly
 * (volink.evidence.dir, outside the web root); an admin gets a 5-minute signed link. The plan's S3 bucket can replace
 * this class later without changing the API.
 */
@Component
public class EvidenceStorage {
    private final Path root;

    public EvidenceStorage(@Value("${volink.evidence.dir:}") String dir) {
        this.root = (dir.isBlank() ? Path.of(System.getProperty("java.io.tmpdir"), "volink-evidence") : Path.of(dir)).toAbsolutePath().normalize();
    }

    public String save(byte[] bytes, String extension) {
        String key = UUID.randomUUID() + "." + extension;
        try {
            Files.createDirectories(root);
            Path file = root.resolve(key);
            Files.write(file, bytes, StandardOpenOption.CREATE_NEW);
            try { Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------")); } catch (UnsupportedOperationException ignored) { }
            return key;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public byte[] read(String key) {
        Path file = root.resolve(key).normalize();
        if (!file.startsWith(root)) throw new IllegalArgumentException("bad key");
        try {
            return Files.readAllBytes(file);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
