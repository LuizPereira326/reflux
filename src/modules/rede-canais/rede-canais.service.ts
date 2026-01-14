import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import playwright from "playwright";
import { createCuimpHttp } from "cuimp";

// Dynamic imports to avoid module loading issues
let playwrightExtra: any;
let stealthInitialized = false;

async function initializeStealth() {
  if (!stealthInitialized) {
    playwrightExtra = require("playwright-extra");
    const StealthPlugin = require("puppeteer-extra-plugin-stealth");
    playwrightExtra.chromium.use(StealthPlugin());
    stealthInitialized = true;
  }
  return playwrightExtra;
}

interface BrowserSession {
  cfClearance: string | null;
  userAgent: string;
  cookies: { name: string; value: string; domain?: string; path?: string }[];
  localStorage: Record<string, string>;
}

class TokenManager {
  private session: BrowserSession = {
    cfClearance: null,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    cookies: [],
    localStorage: {}
  };
  
  private lastRefresh: number = 0;
  private readonly REFRESH_INTERVAL = 1800000; // 30 minutes
  private baseUrl: string;
  private readonly logger = new Logger(TokenManager.name);
  private readonly client;
  
  // CRITICAL: Proxy configuration for IP consistency
  // FORCE DISABLE: Set to null to disable proxy completely
  private readonly proxyConfig = null;
  
  // To enable proxy, uncomment below and set PROXY_URL env var:
  // private readonly proxyConfig = (process.env.PROXY_URL && process.env.PROXY_URL.trim() !== '') 
  //   ? { server: process.env.PROXY_URL.trim() }
  //   : null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Updated to Chrome 133 for better fingerprint
    this.client = createCuimpHttp({
      descriptor: {
        browser: 'chrome',
        version: '133'
      }
    });
  }

  async ensureToken() {
    const now = Date.now();
    if (!this.session.cfClearance || now - this.lastRefresh > this.REFRESH_INTERVAL) {
      await this.refreshToken();
      this.lastRefresh = now;
    }
  }

  private async captureLocalStorage(page: playwright.Page): Promise<Record<string, string>> {
    try {
      const localStorage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            items[key] = window.localStorage.getItem(key) || '';
          }
        }
        return items;
      });
      
      // Log telemetry keys if present
      if (localStorage['rc::a'] || localStorage['rc::f']) {
        this.logger.debug(`✅ Captured Cloudflare telemetry localStorage keys`);
      }
      
      return localStorage;
    } catch (error) {
      this.logger.debug(`Could not capture localStorage: ${error.message}`);
      return {};
    }
  }

  private async humanMouseMovement(page: playwright.Page, box: any) {
    // Generate screen-relative coordinates (larger numbers, more human-like)
    const screenWidth = 1920;
    const screenHeight = 1080;
    
    // Start from a random point on screen (not near target)
    const startX = Math.random() * screenWidth * 0.8;
    const startY = Math.random() * screenHeight * 0.8;
    
    // Target (checkbox) in screen coordinates
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    
    this.logger.debug(`Mouse movement: (${Math.floor(startX)}, ${Math.floor(startY)}) → (${Math.floor(targetX)}, ${Math.floor(targetY)})`);
    
    // Multi-point bezier curve simulation
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(50 + Math.random() * 100);
    
    // First curve point (1/3 of the way)
    const curve1X = startX + (targetX - startX) * 0.3 + (Math.random() - 0.5) * 100;
    const curve1Y = startY + (targetY - startY) * 0.3 + (Math.random() - 0.5) * 100;
    await page.mouse.move(curve1X, curve1Y, { steps: 20 });
    await page.waitForTimeout(30 + Math.random() * 70);
    
    // Second curve point (2/3 of the way)
    const curve2X = startX + (targetX - startX) * 0.7 + (Math.random() - 0.5) * 60;
    const curve2Y = startY + (targetY - startY) * 0.7 + (Math.random() - 0.5) * 60;
    await page.mouse.move(curve2X, curve2Y, { steps: 25 });
    await page.waitForTimeout(40 + Math.random() * 80);
    
    // Final approach with micro-adjustments (human hesitation)
    const finalX = targetX + (Math.random() - 0.5) * 8;
    const finalY = targetY + (Math.random() - 0.5) * 8;
    await page.mouse.move(finalX, finalY, { steps: 15 });
    await page.waitForTimeout(100 + Math.random() * 200);
    
    // Click with slight offset
    await page.mouse.click(
      targetX + (Math.random() - 0.5) * 4,
      targetY + (Math.random() - 0.5) * 4
    );
  }

  private async tryDomain(domain: string, pwExtra: any): Promise<boolean> {
    let browser: any = null;
    
    try {
      this.logger.log(`🔄 Attempting domain: ${domain}`);
      
      // Build launch options conditionally
      const launchOptions: any = {
        headless: true,
        timeout: 60000
      };
      
      // Only add proxy if it's actually configured
      if (this.proxyConfig) {
        launchOptions.proxy = this.proxyConfig;
        this.logger.debug(`Using proxy for browser launch`);
      }
      
      browser = await pwExtra.chromium.launch(launchOptions);
      
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: this.session.userAgent,
        bypassCSP: true,
        javaScriptEnabled: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        // Additional fingerprint resistance
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Chromium";v="133", "Not_A Brand";v="24", "Google Chrome";v="133"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"'
        }
      });

      await context.route("**/*", (route) => route.continue());
      const page = await context.newPage();

      this.logger.debug(`📡 Navigating to ${domain}...`);
      
      // CRITICAL: Use networkidle instead of domcontentloaded
      // This ensures telemetry scripts have time to execute
      await page.goto(domain, { 
        waitUntil: "networkidle", 
        timeout: 60000 
      });

      this.logger.debug(`⏳ Waiting for Cloudflare challenge resolution...`);
      
      // Extended wait for automatic challenge resolution
      await page.waitForTimeout(3000);
      
      // Check for Turnstile challenge
      const turnstileLocator = page.locator('iframe[src*="challenges.cloudflare.com"]');
      const turnstileCount = await turnstileLocator.count();
      
      this.logger.debug(`Turnstile iframes found: ${turnstileCount}`);
      
      if (turnstileCount > 0) {
        this.logger.debug(`🔐 Turnstile challenge detected, attempting interaction...`);
        await page.waitForTimeout(2000);
        
        const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]');
        const checkbox = turnstileFrame.locator('input[type="checkbox"]');
        
        try {
          if (await checkbox.isVisible({ timeout: 5000 })) {
            const box = await checkbox.boundingBox();
            if (box) {
              this.logger.debug(`🖱️  Executing human-like mouse movement...`);
              await this.humanMouseMovement(page, box);
              
              // Wait for Turnstile verification
              this.logger.debug(`⏳ Waiting for Turnstile verification...`);
              await page.waitForTimeout(8000); // Increased wait time
            }
          }
        } catch (checkboxError) {
          this.logger.debug(`Checkbox interaction failed: ${checkboxError.message}`);
        }
      }

      // Wait for cf_clearance with extended timeout
      await this.waitForCfClearance(page, 40000);

      // CRITICAL: Capture all session data
      this.session.userAgent = await page.evaluate(() => navigator.userAgent);
      this.session.cookies = await context.cookies();
      this.session.cfClearance = this.session.cookies.find((c) => c.name === "cf_clearance")?.value || null;
      
      // Capture localStorage for rc keys
      this.session.localStorage = await this.captureLocalStorage(page);

      // Log captured telemetry cookies
      const rcCookies = this.session.cookies.filter(c => c.name.startsWith('cf_chl_rc'));
      if (rcCookies.length > 0) {
        this.logger.debug(`✅ Captured ${rcCookies.length} Cloudflare telemetry cookies`);
      }

      await browser.close();
      browser = null;

      // Validate session
      const totalCookies = this.session.cookies.length;
      const hasLStorage = Object.keys(this.session.localStorage).length > 0;
      
      this.logger.debug(`Session captured: ${totalCookies} cookies, ${Object.keys(this.session.localStorage).length} localStorage items`);
      
      if (this.session.cfClearance) {
        this.baseUrl = domain;
        this.logger.log(`✅ Domain authenticated with cf_clearance: ${domain}`);
        return true;
      } else if (totalCookies > 0) {
        // Some sites work without cf_clearance but with other cookies
        this.baseUrl = domain;
        this.logger.log(`⚠️  Domain accessible without cf_clearance (${totalCookies} cookies): ${domain}`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`❌ Domain failed ${domain}: ${error.message}`);
      return false;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
  }

  async refreshToken() {
    try {
      const pwExtra = await initializeStealth();
      
      if (await this.tryDomain(this.baseUrl, pwExtra)) {
        this.logger.log("✅ Token refreshed successfully");
        return;
      }

      throw new Error("Failed to authenticate with RedeCanais");
    } catch (error) {
      this.logger.error(`Token refresh failed: ${error.message}`);
      throw error;
    }
  }

  private async waitForCfClearance(page: playwright.Page, timeout = 40000) {
    const start = Date.now();
    let lastCheck = 0;
    
    while (Date.now() - start < timeout) {
      const cookies = await page.context().cookies();
      const cfCookie = cookies.find((c) => c.name === "cf_clearance");
      
      if (cfCookie) {
        const elapsed = Date.now() - start;
        this.logger.debug(`✅ cf_clearance obtained after ${elapsed}ms`);
        // Extra wait for telemetry scripts to complete
        await page.waitForTimeout(2000);
        return;
      }
      
      const elapsed = Date.now() - start;
      if (elapsed - lastCheck > 5000) {
        this.logger.debug(`⏳ Waiting for cf_clearance... (${Math.floor(elapsed / 1000)}s)`);
        lastCheck = elapsed;
      }
      
      await page.waitForTimeout(1000);
    }
    
    this.logger.debug(`⏰ Timeout waiting for cf_clearance after ${timeout}ms`);
  }

  getHeaders() {
    // Build cookie string including ALL cookies (telemetry + clearance)
    const cookieString = this.session.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    
    return {
      "User-Agent": this.session.userAgent,
      "Cookie": cookieString,
      "Referer": this.baseUrl,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
      "Upgrade-Insecure-Requests": "1",
      "Connection": "keep-alive",
      "sec-ch-ua": '"Chromium";v="133", "Not_A Brand";v="24", "Google Chrome";v="133"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"'
    };
  }

  async request(options: any) {
    // CRITICAL: Use same proxy as browser (only if configured)
    const requestOptions = {
      ...options,
      ...(this.proxyConfig?.server && { proxy: this.proxyConfig.server })
    };
    
    return this.client.request(requestOptions);
  }

  getBaseUrl() {
    return this.baseUrl;
  }
}

@Injectable()
export class RedeCanaisService {
  private readonly logger = new Logger(RedeCanaisService.name);
  private readonly BASE_URL = "https://redecanais.fm";
  private tokenManager: TokenManager;

  constructor() {
    this.tokenManager = new TokenManager(this.BASE_URL);
    
    // Log proxy status
    if (process.env.PROXY_URL) {
      this.logger.log(`🔒 Using sticky proxy for IP consistency`);
    } else {
      this.logger.log(`ℹ️  Running without proxy (may have reliability issues with Cloudflare)`);
    }
  }

  private async performRequest(url: string, retries = 3): Promise<string> {
    try {
      await this.tokenManager.ensureToken();
    } catch (error) {
      this.logger.warn(`RedeCanais unavailable: ${error.message}`);
      return "";
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.logger.debug(`Making request to: ${url.substring(0, 100)}...`);
        
        const response = await this.tokenManager.request({
          url,
          method: "GET",
          headers: this.tokenManager.getHeaders(),
          timeout: 30000,
        });

        this.logger.debug(`Response received: ${response.data?.length || 0} bytes`);
        return response.data;
      } catch (error) {
        this.logger.debug(`Request failed (attempt ${attempt}/${retries}): ${error.message}`);
        
        // Check for Cloudflare errors
        if (error.message.includes('403') || error.message.includes('1020')) {
          this.logger.warn(`🚫 Cloudflare block detected (${error.message}). Token may need refresh.`);
        }
        
        if (attempt === retries) {
          this.logger.error(`All retries exhausted for ${url}`);
          return "";
        }
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    return "";
  }

  async searchMovies(query: string) {
    return this.searchGeneric(query, "filmes");
  }

  async searchSeries(query: string) {
    return this.searchGeneric(query, "series");
  }

  private async searchGeneric(query: string, type: "filmes" | "series") {
    try {
      const baseUrl = this.tokenManager.getBaseUrl();
      const url = `${baseUrl}/buscar?q=${encodeURIComponent(query)}`;
      const data = await this.performRequest(url);
      if (!data) return [];
      
      const $ = cheerio.load(data);
      const results: any[] = [];
      $(`a[href*="/assistir-${type}/"]`).each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).find("h3, h2, span").first().text().trim();
        if (href && title) {
          results.push({
            title,
            url: href.startsWith("http") ? href : baseUrl + href,
          });
        }
      });
      return results;
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      return [];
    }
  }

  async searchEpisodes(seriesTitle: string) {
    try {
      const series = await this.searchSeries(seriesTitle);
      if (!series.length) return [];
      const data = await this.performRequest(series[0].url);
      if (!data) return [];
      
      const $ = cheerio.load(data);
      const episodes: any[] = [];
      const baseUrl = this.tokenManager.getBaseUrl();
      $('a[href*="/episodio/"]').each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).text().trim();
        if (href) {
          episodes.push({
            title,
            url: href.startsWith("http") ? href : baseUrl + href,
          });
        }
      });
      return episodes;
    } catch (error) {
      this.logger.error(`Episodes search failed: ${error.message}`);
      return [];
    }
  }

  async getMovieStream(pageUrl: string): Promise<string | null> {
    try {
      const data = await this.performRequest(pageUrl);
      if (!data) return null;
      
      const $ = cheerio.load(data);
      let iframe = $("iframe[src]").first().attr("src") || $("iframe[data-src]").first().attr("data-src");
      if (!iframe) return null;
      
      const baseUrl = this.tokenManager.getBaseUrl();
      if (!iframe.startsWith("http")) {
        iframe = baseUrl + iframe;
      }
      const playerData = await this.performRequest(iframe);
      if (!playerData) return null;
      
      const m3u8 = playerData.match(/https?:\/\/[^"' ]+\.m3u8/);
      if (m3u8) return m3u8[0];
      const mpd = playerData.match(/https?:\/\/[^"' ]+\.mpd/);
      if (mpd) return mpd[0];
      const mp4 = playerData.match(/https?:\/\/[^"' ]+\.mp4/);
      if (mp4) return mp4[0];
      return null;
    } catch (error) {
      this.logger.error(`Stream extraction failed: ${error.message}`);
      return null;
    }
  }

  async getPopularMovies() {
    try {
      const baseUrl = this.tokenManager.getBaseUrl();
      const url = `${baseUrl}/genero/filmes-de-acao-online-1/`;
      const data = await this.performRequest(url);
      if (!data) return [];
      
      const $ = cheerio.load(data);
      const results: any[] = [];
      $('article a[href*="/assistir-"]').each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).find("img").attr("alt") || $(el).text().trim();
        const poster = $(el).find("img").attr("src");
        if (href && title) {
          results.push({
            title,
            url: href.startsWith("http") ? href : baseUrl + href,
            poster,
          });
        }
      });
      return results.slice(0, 20);
    } catch (error) {
      this.logger.error(`Popular movies fetch failed: ${error.message}`);
      return [];
    }
  }

  async getPopularSeries() {
    try {
      const baseUrl = this.tokenManager.getBaseUrl();
      const url = `${baseUrl}/genero/series-de-acao-online-1/`;
      const data = await this.performRequest(url);
      if (!data) return [];
      
      const $ = cheerio.load(data);
      const results: any[] = [];
      $('article a[href*="/assistir-"]').each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).find("img").attr("alt") || $(el).text().trim();
        const poster = $(el).find("img").attr("src");
        if (href && title) {
          results.push({
            title,
            url: href.startsWith("http") ? href : baseUrl + href,
            poster,
          });
        }
      });
      return results.slice(0, 20);
    } catch (error) {
      this.logger.error(`Popular series fetch failed: ${error.message}`);
      return [];
    }
  }
}
