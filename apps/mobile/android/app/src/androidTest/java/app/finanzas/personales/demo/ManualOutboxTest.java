package app.finanzas.personales.demo;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Runs twice against the installed app, with a process kill between seed and reopen. */
@RunWith(AndroidJUnit4.class)
public class ManualOutboxTest {
  private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
  private final UiAutomation automation = instrumentation.getUiAutomation();
  private MainActivity activity;
  private void shell(String command) throws Exception {
    try (FileInputStream output = new android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command))) {
      byte[] buffer = new byte[1024];
      while (output.read(buffer) != -1) { /* Wait for the command to complete. */ }
    }
  }
  private void unlockSyntheticDevice(android.app.KeyguardManager keyguard) throws Exception {
    int width = activity.getResources().getDisplayMetrics().widthPixels;
    int height = activity.getResources().getDisplayMetrics().heightPixels;
    for (int attempt = 0; attempt < 3 && keyguard.isKeyguardLocked(); attempt++) {
      shell("input keyevent 224");
      shell("input swipe " + width / 2 + " " + height * 4 / 5 + " " + width / 2 + " " + height / 5 + " 300");
      Thread.sleep(1000); // Let the secure PIN bouncer finish its animation.
      if (!keyguard.isKeyguardLocked()) break;
      shell("input text 123456"); // Disposable AVD PIN installed by the test runner.
      shell("input keyevent 66");
      for (int poll = 0; poll < 20 && keyguard.isKeyguardLocked(); poll++) Thread.sleep(250);
    }
    assertFalse("Synthetic AVD must be unlocked before financial UI tests", keyguard.isKeyguardLocked());
  }
  private String js(String source) throws Exception {
    CountDownLatch latch = new CountDownLatch(1);
    AtomicReference<String> result = new AtomicReference<>();
    instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(source, value -> { result.set(value); latch.countDown(); }));
    assertTrue("WebView response", latch.await(10, TimeUnit.SECONDS));
    return String.valueOf(new JSONTokener(result.get()).nextValue());
  }
  private void waitFor(String expression) throws Exception {
    for (int i = 0; i < 120; i++) {
      if ("true".equals(js(expression))) return;
      Thread.sleep(250);
    }
    fail("UI condition failed: " + expression + "; feedback=" + js("document.querySelector('.manual-feedback')?.textContent"));
  }
  private void click(String label) throws Exception {
    js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===" + org.json.JSONObject.quote(label) + ")?.click()");
  }
  private void fill(String name, String value) throws Exception {
    js("(()=>{const e=document.querySelector('[name=" + name + "]');e.value=" + org.json.JSONObject.quote(value) + ";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  }
  @Test public void encryptedPendingSurvivesProcessDeath() throws Exception {
    String stage = InstrumentationRegistry.getArguments().getString("stage");
    File damaged = null;
    if ("corrupt".equals(stage)) {
      for (String name : instrumentation.getTargetContext().databaseList()) {
        if (name.startsWith("finanzas_manual_") && name.endsWith(".db")) {
          damaged = instrumentation.getTargetContext().getDatabasePath(name);
          try (RandomAccessFile file = new RandomAccessFile(damaged, "rw")) { file.write(new byte[16]); }
        }
      }
      assertNotNull("Existing synthetic database to corrupt", damaged);
    }
    Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    activity = (MainActivity) instrumentation.startActivitySync(intent);
    android.app.KeyguardManager keyguard = (android.app.KeyguardManager) activity.getSystemService(android.content.Context.KEYGUARD_SERVICE);
    unlockSyntheticDevice(keyguard);
    for (int i = 0; i < 40 && !activity.hasWindowFocus(); i++) Thread.sleep(250);
    assertTrue("Native foreground window; keyguardLocked=" + keyguard.isKeyguardLocked(), activity.hasWindowFocus());
    waitFor("!!document.querySelector('fp-shell') || !!document.querySelector('main')");
    js("location.hash='/registro'");
    waitFor("!!document.querySelector('.manual-page')");
    click("Probar con datos DEMO");
    if (damaged != null) {
      waitFor("document.querySelector('.manual-feedback').textContent.includes('No se completó')");
      assertEquals("0", js("document.querySelectorAll('[name=amount]').length"));
      byte[] header = new byte[16];
      try (FileInputStream input = new FileInputStream(damaged)) { assertEquals(16, input.read(header)); }
      assertArrayEquals("Damaged vault must not be recreated", new byte[16], header);
      return;
    }
    waitFor("!!document.querySelector('[name=credential]')");
    fill("credential", "123456");
    boolean seed = "seed".equals(stage);
    if (!seed) {
      fill("credential", "654321");
      click("Desbloquear");
      waitFor("document.querySelector('.manual-feedback').textContent.includes('No se completó')");
      fill("credential", "123456");
    }
    click(seed ? "Crear espacio cifrado" : "Desbloquear");
    waitFor("!!document.querySelector('[name=amount]')");
    if (seed) {
      fill("account", "00000000-0000-4000-8000-000000000081");
      fill("category", "00000000-0000-4000-8000-000000000083");
      fill("amount", "0.10");
      fill("date", "2026-01-01");
      fill("note", "Synthetic Android offline");
      js("(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Guardar pendiente');for(let i=0;i<5;i++)b.click();})()");
    }
    waitFor("document.querySelectorAll('.pending-row').length===1");
    String text = js("document.querySelector('.pending-row').textContent");
    assertTrue(text.contains("PEN 0.10"));
    assertTrue(text.contains("2026-01-01"));
    assertTrue(text.contains("America/Lima"));
    assertTrue(text.contains("Pendiente local"));
    boolean checked = false;
    for (String name : instrumentation.getTargetContext().databaseList()) {
      if (!name.startsWith("finanzas_manual_") || !name.endsWith(".db")) continue;
      File file = instrumentation.getTargetContext().getDatabasePath(name);
      byte[] header = new byte[16];
      try (FileInputStream input = new FileInputStream(file)) { assertEquals(16, input.read(header)); }
      assertFalse("SQLCipher required", new String(header, StandardCharsets.US_ASCII).startsWith("SQLite format 3"));
      checked = true;
    }
    assertTrue("Real encrypted database present", checked);
    js("document.querySelector('.pending-row').scrollIntoView({block:'center'})");
    CountDownLatch drawn = new CountDownLatch(1);
    instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().postVisualStateCallback(1, new WebView.VisualStateCallback() {
      @Override public void onComplete(long requestId) { drawn.countDown(); }
    }));
    assertTrue("WebView visual state", drawn.await(10, TimeUnit.SECONDS));
    Thread.sleep(500);
    Bitmap screenshot = automation.takeScreenshot();
    assertEquals("Pending remains visible during screenshot", "1", js("document.querySelectorAll('.pending-row').length"));
    assertNotNull("Native screenshot before instrumentation closes activity", screenshot);
    File evidence = new File(instrumentation.getTargetContext().getExternalFilesDir(null), seed ? "p08-seed.png" : "p08-reopen.png");
    try (FileOutputStream output = new FileOutputStream(evidence)) {
      assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output));
    }
    screenshot.recycle();
  }
}
