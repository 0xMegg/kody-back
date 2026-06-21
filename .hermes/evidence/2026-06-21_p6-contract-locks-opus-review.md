# P6 contract-test/importer locks — phase-end evidence

## Scope

Approved scope: P3/P3.5 contract-test/importer locks only.

Forbidden surfaces remained untouched: schema/migration/DB write/import/commit/deploy/package-lock/env.

Changed files:

```text
tests/imweb-product-importer.test.ts
tests/imweb-product-upsert-service.test.ts
tests/product-routes.test.ts
tests/product-schema-contract.test.ts
```

## Verification

Focused suite:

```text
npm test -- --run tests/product-schema-contract.test.ts tests/imweb-product-importer.test.ts tests/imweb-product-upsert-service.test.ts tests/product-routes.test.ts tests/product-derived-response.test.ts
# Result: 5 passed, 94 tests passed
```

TypeScript/lint:

```text
npm run lint
# Result: tsc --noEmit passed
```

Full backend suite:

```text
npm test -- --run
# Result: 32 passed, 445 tests passed
```

Forbidden surface check:

```text
Changed files:
tests/imweb-product-importer.test.ts
tests/imweb-product-upsert-service.test.ts
tests/product-routes.test.ts
tests/product-schema-contract.test.ts

Forbidden changed files: none
Untracked files: none
```

## Claude Opus read-only review

Command shape:

```text
git diff -- tests/product-schema-contract.test.ts tests/imweb-product-importer.test.ts tests/imweb-product-upsert-service.test.ts tests/product-routes.test.ts | claude -p --model opus
```

Review result:

```text
검증 완료. 4개 테스트 파일의 모든 신규 단언을 실제 구현(`imweb-product-importer.ts`, `product-service.ts`, `prisma/schema.prisma`)과 대조했고 전부 일치합니다.

## 결과: **PASS** ✅

**스코프 준수 (PASS)**
- 변경 대상은 테스트 4종뿐. schema/migration/DB write/import/commit/deploy/lock/env 무변경. 승인 범위(contract-test/importer lock) 내.

**P3/P3.5 계약 커버리지 (PASS)**
- 제조사→`releaseDateText` 리매핑 + 안전치 못한 날짜 `releaseDate: null` → `imweb-product-importer.ts:114-115` 일치.
- 필수옵션값 dedup(공백정규화 포함, `'MUSIC PLANET','KTOWN4U'`) + variant/stock 시맨틱 부재 → `parseOptionValues` (`:463`), `replaceImwebProductOptions`(priceDelta=0, snapshot/stock 미생성) 일치.
- 바코드 중복 허용(SKU 정체성, 바코드는 검색증거): `assertSkuAvailable`이 `findFirst({where:{sku}})`만 검사, 바코드 미차단 → `:1284`, `:1037` 일치.
- create 데이터에 `artistId`/`externalProductId` 부재(`labelName`=artistName), `importRow.create` 미호출 → `toImwebProductWriteData`(`:1715`), `writeImwebImportRow` early-return(`:1233`) 일치.
- 스키마 계약: `stockSnapshot Int?`(nullable·non-default), `stockOnHand` 부재, `model ProductVariant` 부재, Product nullable 필드/`@default` → `schema.prisma:388-390, 484-496` 공백까지 일치.
- dry-run의 hidden write flag 무시 → 라우트 쓰기 미호출 단언.

**잔여 블로커: 없음**

참고(비차단): 환경상 테스트 직접 실행은 승인 거부되어 정적 대조로 검증함. 머지 전 CI 1회 그린 확인만 권장.
```

Note: Claude's note about not directly running tests applies to Claude's review environment only. Local Hermes verification above did run the tests and lint successfully.
