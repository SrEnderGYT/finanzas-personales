package app.finanzas.personales.demo;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Runs twice against the installed app, with a process kill between seed and reopen. */
@RunWith(AndroidJUnit4.class)
public class ManualOutboxTest {
  private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
  private MainActivity activity;
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
    Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    activity = (MainActivity) instrumentation.startActivitySync(intent);
    waitFor("!!document.querySelector('fp-shell') || !!document.querySelector('main')");
    js("location.hash='/registro'");
    waitFor("!!document.querySelector('.manual-page')");
    click("Probar con datos DEMO");
    waitFor("!!document.querySelector('[name=credential]')");
    fill("credential", "123456");
    boolean seed = "seed".equals(InstrumentationRegistry.getArguments().getString("stage"));
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
    instrumentation.waitForIdleSync();
    Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
    assertNotNull("Native screenshot before instrumentation closes activity", screenshot);
    File evidence = new File(instrumentation.getTargetContext().getExternalFilesDir(null), seed ? "p08-seed.png" : "p08-reopen.png");
    try (FileOutputStream output = new FileOutputStream(evidence)) {
      assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output));
    }
    screenshot.recycle();
  }
}
