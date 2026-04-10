import { PrismaClient } from "../../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "../config.js";

type Mapping = {
  url: string;
  names: string[];
  note?: string;
};

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mappings: Mapping[] = [
  {
    url: "https://caterskladinventory.b-cdn.net/Beton%20plato%20kanapky1.webp",
    names: ["Beton plato kanapky"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Betonova%CC%81%20miska%20mala%CC%81.webp",
    names: ["Betonová mísa mala"],
    note: "Existing product name in source data differs slightly from the asset name.",
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Betonove%CC%81%20plato%20str%CC%8Cedni%CC%81.webp",
    names: ["Beton plato kanapky strřední"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Bry%CC%81le%20svi%CC%81ti%CC%81ci%CC%81.webp",
    names: ["Brýlé svítící"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Dr%CC%8Ceve%CC%8Cna%CC%81%20bedy%CC%81nka%20c%CC%8Cerna%CC%81%20velka%CC%81%20-%20mala%CC%81.webp",
    names: ["Dřevěná bedýnka černá - malá / velká"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Dr%CC%8Ceve%CC%8Cna%CC%81%20bedy%CC%81nka%20opa%CC%81lena%CC%81%20velka%CC%81%20-%20mala%CC%81.webp",
    names: ["Dřevěná bedýnka opálená - malá / velká"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Dra%CC%81te%CC%8Cny%CC%81%20stu%CC%8Al%20s%20deskami%20koncept.webp",
    names: ["Drátěný stůl s deskami komplet"],
    note: "Source inventory item uses 'komplet' instead of the CDN asset's 'koncept'.",
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Dz%CC%8Cber%20dr%CC%8Ceve%CC%8Cny%CC%81%20na%20ma%CC%81slo.webp",
    names: ["Džber dřevěná na máslo"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Etaz%CC%8Cer%20str%CC%8Ci%CC%81brny%CC%81%20maly%CC%81%20na%20bombony.webp",
    names: ["Etažer stříbrný na bombony"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Etaz%CC%8Cer%20transparentni%CC%81%203%20patra.webp",
    names: ["Etažer transparetní 3 patra"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Long%20Old.webp",
    names: ["Sklo Long Old"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Lz%CC%8Ci%CC%81ce%20dezertni%CC%81%20banket.webp",
    names: ["Lžíce moučníková banket"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Pana%CC%81k%20stopka.webp",
    names: ["Sklo Panák stopka"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Peka%CC%81c%CC%8C%20litinovy%CC%81%20c%CC%8Cerny%CC%81%20(2c%CC%8Ca%CC%81sti).webp",
    names: ["Pekáč litinový černý (2 části)"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Plato%20transparentni%CC%81%20Sweet%20bar.webp",
    names: ["Plato transparentní na Sweet bar"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Plato%20zlate%CC%81%20se%20zrcadlem.webp",
    names: ["Plato zalté se zrcadlem"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Plny%CC%81%20stu%CC%8Al%20s%20deskami%20koncept.webp",
    names: ["Plný stůl s deskou komplet"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Pr%CC%8Ci%CC%81slus%CC%8Censtvi%CC%81%20roznosovy%CC%81%20pa%CC%81s%201.webp",
    names: ["Koncept příslušenství (pásky, kleště, palice)"],
    note: "The schema supports only one image per item; a second roznosový pás image remains unassigned.",
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20Long%20Cassiopea.webp",
    names: ["Sklo Long Casiopea"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20Pivo%20Plzen%CC%8C%200%2C5l.webp",
    names: ["Sklo Pivo Plzeň"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20Va%CC%81za%20zkumavka.webp",
    names: ["Váza Zkumavka"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20Vino%20Sandra.webp",
    names: ["Sklo Víno Sandra"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20Whisky%20Cassiopea%20c%CC%8Cerna%CC%81.webp",
    names: ["Sklo Whisky Cassiopea"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20na%20pas%CC%8Ctiku%20pr%CC%8Cedkrm.webp",
    names: ["Sklo na paštiku"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Sklo%20svi%CC%81cen%20na%20c%CC%8Cajovku.webp",
    names: ["Sklo svícen na čajovou svíčku"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Spojovaci%CC%81%20ty%CC%81c%CC%8C.webp",
    names: ["Spojovací tyč koncept klasická"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Spojovaci%CC%81%20tyc%CC%8C%20koncept%20elektricka%CC%81.webp",
    names: ["Spojovací týč koncept elektrická"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Tali%CC%81r%CC%8C%20c%CC%8Ctverec%20Langenthal.webp",
    names: ["Talíř čtverec malý Lagenthal"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Tali%CC%81r%CC%8C%20obde%CC%81lni%CC%81k%20Langenthal.webp",
    names: ["Talíř obdelník Lagenthal"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Tali%CC%81r%CC%8Cek%20ova%CC%81lny%CC%81%20pr%CC%8Cedkrm.webp",
    names: ["Talířek oválný"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Truhli%CC%81k%20c%CC%8Cerny%CC%81%20na%20pr%CC%8Ci%CC%81bory.webp",
    names: ["Truhlík na příbory kovový černý"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Vyvy%CC%81s%CC%8Cenina%20c%CC%8Cerveny%CC%81%20strom.webp",
    names: ["Vyvýšenina strom červená"],
  },
  {
    url: "https://caterskladinventory.b-cdn.net/Vyvy%CC%81s%CC%8Cenina%20str%CC%8Ci%CC%81brna%CC%81%20%2B%20Br%CC%8Cidlice.webp",
    names: ["Vyvýšenina stříbrná"],
    note: "The asset includes the břidlice accessory, but the main inventory item is the silver pedestal.",
  },
  {
    url: "https://caterskladinventory.b-cdn.net/sklo%20pepr%CC%8Cenka%20sla%CC%81nka.webp",
    names: ["Pepřenka slánka sklo"],
  },
];

const unresolvedUrls = [
  "https://caterskladinventory.b-cdn.net/Betonova%CC%81%20mi%CC%81sa%20velka%CC%81.webp",
  "https://caterskladinventory.b-cdn.net/C%CC%8Cerveny%CC%81%20hrnec.webp",
  "https://caterskladinventory.b-cdn.net/C%CC%8Coko%20fonta%CC%81na.webp",
  "https://caterskladinventory.b-cdn.net/Dezertni%CC%81%20pr%CC%8Ci%CC%81bor%20Sol.webp",
  "https://caterskladinventory.b-cdn.net/Ice%20ky%CC%81bl%20maly%CC%81%20I.webp",
  "https://caterskladinventory.b-cdn.net/Ka%CC%81vova%CC%81%20lz%CC%8Cic%CC%8Cka%20%2B%20Dezertni%CC%81%20lz%CC%8Cic%CC%8Cka.webp",
  "https://caterskladinventory.b-cdn.net/Kve%CC%8Ctina%CC%81c%CC%8C%20beton.webp",
  "https://caterskladinventory.b-cdn.net/LED%20USB%20na%20la%CC%81hev%202.webp",
  "https://caterskladinventory.b-cdn.net/Lampic%CC%8Cka%20LED%20USB%20bi%CC%81la%CC%81.webp",
  "https://caterskladinventory.b-cdn.net/Long%20rovna%CC%81.webp",
  "https://caterskladinventory.b-cdn.net/Lz%CC%8Ci%CC%81ce%20pr%CC%8Cedkrm%20banket.webp",
  "https://caterskladinventory.b-cdn.net/Nu%CC%8Az%CC%8C%20dort.webp",
  "https://caterskladinventory.b-cdn.net/Podluz%CC%8Covaci%CC%81%20kabel.webp",
  "https://caterskladinventory.b-cdn.net/Pr%CC%8Ci%CC%81slus%CC%8Censtvi%CC%81%20roznosovy%CC%81%20pa%CC%81s%202.webp",
  "https://caterskladinventory.b-cdn.net/Sklo%20Pana%CC%81k%20stopka%20brus.webp",
  "https://caterskladinventory.b-cdn.net/Sklo%20Sekt%20brous%CC%8Cene%CC%81.webp",
  "https://caterskladinventory.b-cdn.net/Tali%CC%81r%CC%8C%20c%CC%8Ctverec%20pr%CC%8Cedkrm.webp",
  "https://caterskladinventory.b-cdn.net/Tali%CC%81r%CC%8C%20dezertni%CC%81%20s%CC%8Cedy%CC%81-.webp",
  "https://caterskladinventory.b-cdn.net/Teflon%20grill.webp",
  "https://caterskladinventory.b-cdn.net/Truhli%CC%81k%20na%20bylinky.webp",
  "https://caterskladinventory.b-cdn.net/USB%20lampic%CC%8Cka%20CBX.webp",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const uniqueNames = [...new Set(mappings.flatMap((entry) => entry.names))];
  const items = await prisma.inventoryItem.findMany({
    where: {
      name: { in: uniqueNames },
    },
    orderBy: { name: "asc" },
  });

  const byName = new Map<string, typeof items>();
  for (const item of items) {
    const list = byName.get(item.name) ?? [];
    list.push(item);
    byName.set(item.name, list);
  }

  let updates = 0;
  for (const mapping of mappings) {
    const matchedItems = mapping.names.flatMap((name) => byName.get(name) ?? []);
    if (matchedItems.length === 0) {
      console.log(`MISSING ITEM\t${mapping.url}\t${mapping.names.join(" | ")}`);
      continue;
    }

    for (const item of matchedItems) {
      const changed = item.imageUrl !== mapping.url;
      console.log(
        `${changed ? "SET" : "KEEP"}\t${item.name}\t${item.id}\t${item.imageUrl ?? "NULL"} -> ${mapping.url}${
          mapping.note ? `\t${mapping.note}` : ""
        }`
      );
      if (apply && changed) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { imageUrl: mapping.url },
        });
        updates += 1;
      }
    }
  }

  console.log(`\n${apply ? "UPDATED" : "DRY RUN"}\t${updates}`);
  console.log(`UNRESOLVED_URLS\t${unresolvedUrls.length}`);
  for (const url of unresolvedUrls) {
    console.log(`UNRESOLVED\t${url}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
