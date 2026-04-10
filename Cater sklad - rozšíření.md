
rozšíření tabulky a kategorií viz: @Sklad_new.xlsx - nutno rozšířit DTB na supabase


 řazení podle kategorie
- Seřazení podle kategorie
	- 1. Mobiliář
	- 2. Sklo
	- 3. Porcelán
	- 4. Příbory
	- 5. Dekorace 
	- 6. Prádlo
	- 7. Inventář
	- 8. Zboží

Do DTB přidat dle tabulky - Zadán počet i na master balení pro sklad. Ale event managera v objednávce zadává počet kusů a z toho se napočítá počet master balení, které je nutné zabalit skladem - je potřeba, aby hlídalo, aby se přidalo vždycky o master balení víc. 
- při vracení musí být ale počet kusů - ať máme přehled o kusech. Vracení položek skladníkem na kusy

Přidat našeptávač - např. objednám kávovar, upozornění, že musím zabalit i kávu - přidány do tabulky cross sell produkty
- zároveň na konec přidat reminder, že tam není něco přidáno a možnost odkliknout, že jsem si vědom, že nemám.

Změna v PDF exportu
- čtvereček s potvrzením v exportu pdf dát před název produktu, zarovnat doleva - ať se lépe pracuje
- V exportu pro sklad řadit podle kategorie viz výše. 
	- sekundárně pak podle parent categorie

Nesmí jít editovat akce, kde je datum v minulosti. 

Rozšíření profilu Skladník
Možnost skladu zablokovat množství na konkrétní datum akce +1 den - return delay days pryč, toto bude manuálně ovládat sklad a nastavovat. Dojde tedy k rozšíření práce skladu. 

Převody mezi sklady - sloupec INVENTORY
- Když si Sklad Cubex nechá věci z akce, nevyzvednou se, tak se naskladní na sklad cubex.
	- skladník bude mít možnost při vrácení zboží určit sklad vrácení. 
- Poté může ručně přesouvat mezi sklady. 

Připravit app na budoucí práci s QR kódy, které budou na master balení. 


Záloha

Vážení podle palet.
- Počet palet. 

Obrázky jsem přesunul na bunny.net  stáhnout si přes API, doplnit do tabulky k příslušnému produktu podle názvu - obrázky se jmenují stejně jako název produktu v tabulce. API key poskytnu. 