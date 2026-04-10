import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";
import path from "node:path";

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function listBunnyFiles(storageZone: string, apiKey: string) {
  const url = `https://storage.bunnycdn.com/${storageZone}/`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      AccessKey: apiKey,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list Bunny.net files: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Array<{
    ObjectName: string;
    IsDirectory: boolean;
    Path: string;
  }>;
}

async function sync() {
  const storageZone = env.BUNNY_STORAGE_ZONE;
  const apiKey = env.BUNNY_API_KEY;

  if (!storageZone || !apiKey) {
    console.error("❌ BUNNY_STORAGE_ZONE or BUNNY_API_KEY missing in .env");
    process.exit(1);
  }

  console.log(`🔍 Listing files from Bunny.net storage zone: ${storageZone}...`);
  const files = await listBunnyFiles(storageZone, apiKey);
  const imageFiles = files.filter(f => !f.IsDirectory && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.ObjectName));
  
  console.log(`✅ Found ${imageFiles.length} images on Bunny.net.`);

  const items = await prisma.inventoryItem.findMany();
  console.log(`📦 Found ${items.length} items in database.`);

  const matches: Array<{ itemId: string; name: string; filename: string }> = [];
  
  console.log(`\n📄 Sample Filenames from Bunny.net:`);
  imageFiles.slice(0, 10).forEach(f => console.log(` - "${f.ObjectName}"`));

  console.log(`\n📦 Sample Item Names from Database:`);
  items.slice(0, 10).forEach(i => console.log(` - "${i.name}"`));

  for (const item of items) {
    const normalize = (s: string) => 
      s.normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "") // remove accents
       .replace(/[^a-z0-9]/gi, "")     // keep only alphanumeric
       .toLowerCase();

    const getTokens = (s: string) => 
      s.normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "")
       .replace(/[^a-z0-9]/gi, " ") // Use spaces here to split into words
       .toLowerCase()
       .split(/\s+/)
       .filter(w => w.length > 1); // Ignore single chars/empty

    const normalizedItemName = normalize(item.name);
    const itemTokens = getTokens(item.name);
    if (itemTokens.length === 0) continue;
    
    const match = imageFiles.map(f => {
      const ext = path.extname(f.ObjectName);
      const filenameWithoutExt = f.ObjectName.slice(0, -ext.length);
      const normalizedFile = normalize(filenameWithoutExt);
      const fileTokens = getTokens(filenameWithoutExt);
      
      let score = 0;

      // 1. Exact match (post-normalization)
      if (normalizedFile === normalizedItemName) score += 20;
      
      // 2. Substring match
      if (normalizedFile.includes(normalizedItemName) || normalizedItemName.includes(normalizedFile)) {
        score += 10;
      }

      // --- ADVANCED MATCHING ---
      
      // 3. Token Overlap with Similarity
      let overlappedTokens = 0;
      let importantWordMatch = false;
      const commonWords = ["cerna", "bila", "seda", "zlaty", "stribrny", "maly", "velky", "stredni", "kolecko", "nozka"];

      for (const iToken of itemTokens) {
        if (fileTokens.some(fToken => {
          const isMatch = fToken === iToken || fToken.includes(iToken) || iToken.includes(fToken);
          if (isMatch && !commonWords.includes(iToken)) {
            importantWordMatch = true;
          }
          return isMatch;
        })) {
          overlappedTokens++;
        } else {
          // Fuzzy match for longer tokens
          if (fileTokens.some(fToken => {
            if (fToken.length < 5 || iToken.length < 5) return false;
            if (fToken.slice(0, 4) === iToken.slice(0, 4) && Math.abs(fToken.length - iToken.length) <= 2) {
              if (!commonWords.includes(iToken)) importantWordMatch = true;
              return true;
            }
            return false;
          })) {
            overlappedTokens++;
          }
        }
      }

      if (overlappedTokens > 0) {
        const overlapRatio = overlappedTokens / Math.max(itemTokens.length, fileTokens.length);
        score += overlapRatio * 15;
        
        // Technical terms bonus
        const technicalTerms = ["usb", "led", "rgb", "xl", "1m", "2m", "3m", "5m"];
        if (itemTokens.some(t => technicalTerms.includes(t)) && fileTokens.some(t => technicalTerms.includes(t))) {
          score += 5;
        }

        // Penalty if NO important words match (only color/size)
        if (!importantWordMatch && overlappedTokens < 2) {
          score -= 10;
        }
      }

      return { file: f, score };
    }).filter(m => m.score > 10) // Restored higher threshold
      .sort((a, b) => b.score - a.score)[0]?.file;

    if (match) {
      matches.push({
        itemId: item.id,
        name: item.name,
        filename: match.ObjectName
      });
    }
  }

  console.log(`\n📊 Matching results:`);
  console.log(`-------------------`);
  console.log(`Total items: ${items.length}`);
  console.log(`Matches found: ${matches.length}`);
  
  if (matches.length > 0) {
    console.log(`\nSample matches:`);
    matches.slice(0, 5).forEach(m => console.log(` - ${m.name} -> ${m.filename}`));
  }

  const isDryRun = process.argv.includes("--dry-run");
  
  if (isDryRun) {
    console.log(`\n⚠️ DRY RUN: Database NOT updated.`);
    console.log(`To apply changes, run without --dry-run`);
  } else if (matches.length > 0) {
    console.log(`\n🚀 Updating database...`);
    for (const match of matches) {
      await prisma.inventoryItem.update({
        where: { id: match.itemId },
        data: { imageUrl: `bunny://${match.filename}` }
      });
    }
    console.log(`✅ Successfully updated ${matches.length} items.`);
  } else if (!isDryRun) {
    console.log(`\nℹ️ No matches found to update.`);
  }

  // --- REPORT UNMATCHED ---
  const matchedFileNames = new Set(matches.map(m => m.filename));
  const unmatched = imageFiles.filter(f => !matchedFileNames.has(f.ObjectName));
  
  if (unmatched.length > 0) {
    console.log(`\n❌ UNMATCHED IMAGES (${unmatched.length}):`);
    console.log(`-------------------`);
    unmatched.forEach(f => console.log(` - ${f.ObjectName}`));
  }

  await prisma.$disconnect();
}

sync().catch(err => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
