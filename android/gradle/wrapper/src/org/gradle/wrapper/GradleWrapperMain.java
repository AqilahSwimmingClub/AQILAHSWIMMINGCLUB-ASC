package org.gradle.wrapper;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Pengunduh dan penjalan distribusi Gradle yang ringkas.
 *
 * Berkas ini WAJIB dikompilasi dengan --release 11. Versi sebelumnya
 * dikompilasi untuk Java 21, sehingga JDK 17 menolak memuatnya dengan
 * UnsupportedClassVersionError, sementara Gradle 8.9 sendiri menolak Java 25.
 * Akibatnya tidak ada satu pun JDK yang bisa memenuhi keduanya.
 *
 * Perintah kompilasi ulang ada di README di folder yang sama.
 */
public class GradleWrapperMain {

    public static void main(String[] args) throws Exception {
        File wrapperDir = wrapperDir();
        Properties config = readProperties(new File(wrapperDir, "gradle-wrapper.properties"));
        String distributionUrl = config.getProperty("distributionUrl",
                "https://services.gradle.org/distributions/gradle-8.9-bin.zip");

        String archiveName = distributionUrl.substring(distributionUrl.lastIndexOf('/') + 1);
        String distName = archiveName.endsWith(".zip")
                ? archiveName.substring(0, archiveName.length() - 4)
                : archiveName;
        String versionDir = distName.endsWith("-bin")
                ? distName.substring(0, distName.length() - 4)
                : distName.endsWith("-all") ? distName.substring(0, distName.length() - 4) : distName;

        File distsDir = new File(System.getProperty("user.home"), ".gradle/wrapper/dists/" + distName);
        File gradleHome = new File(distsDir, versionDir);

        if (!launcher(gradleHome, true).exists() && !launcher(gradleHome, false).exists()) {
            distsDir.mkdirs();
            File archive = new File(distsDir, archiveName);
            if (!archive.exists()) {
                System.out.println("Mengunduh " + distributionUrl);
                File partial = new File(distsDir, archiveName + ".part");
                try (InputStream in = new URL(distributionUrl).openStream()) {
                    Files.copy(in, partial.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
                // Berkas separuh unduhan tidak boleh dianggap arsip yang sah
                // pada percobaan berikutnya, jadi namanya baru diubah setelah tuntas.
                if (!partial.renameTo(archive)) {
                    throw new java.io.IOException("Gagal menyelesaikan unduhan: " + partial);
                }
            }
            unzip(archive, distsDir);
        }

        boolean windows = System.getProperty("os.name").toLowerCase().contains("win");
        File launcher = launcher(gradleHome, windows);
        if (!windows) {
            launcher.setExecutable(true, false);
        }

        List<String> command = new ArrayList<>();
        command.add(launcher.getAbsolutePath());
        command.addAll(Arrays.asList(args));

        Process process = new ProcessBuilder(command)
                .inheritIO()
                .directory(new File(System.getProperty("user.dir")))
                .start();
        System.exit(process.waitFor());
    }

    private static File launcher(File gradleHome, boolean windows) {
        return new File(gradleHome, "bin/gradle" + (windows ? ".bat" : ""));
    }

    /** Folder tempat gradle-wrapper.jar ini berada. */
    private static File wrapperDir() {
        try {
            File jar = new File(GradleWrapperMain.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI());
            return jar.isFile() ? jar.getParentFile() : jar;
        } catch (Exception ignored) {
            return new File("gradle/wrapper");
        }
    }

    private static Properties readProperties(File file) {
        Properties properties = new Properties();
        if (file.isFile()) {
            try (InputStream in = new FileInputStream(file)) {
                properties.load(in);
            } catch (Exception ignored) {
                // Nilai baku dipakai bila berkas tidak terbaca.
            }
        }
        return properties;
    }

    private static void unzip(File archive, File target) throws Exception {
        byte[] buffer = new byte[8192];
        try (ZipInputStream zip = new ZipInputStream(new FileInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                File out = new File(target, entry.getName());
                // Cegah entri arsip menulis di luar folder tujuan.
                if (!out.getCanonicalPath().startsWith(target.getCanonicalPath() + File.separator)) {
                    throw new java.io.IOException("Entri arsip tidak aman: " + entry.getName());
                }
                if (entry.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                out.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    int read;
                    while ((read = zip.read(buffer)) > 0) {
                        os.write(buffer, 0, read);
                    }
                }
            }
        }
    }
}
