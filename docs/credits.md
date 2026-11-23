# 그림과 외부 구성 요소의 출처

## 캠퍼스 배경과 게임 그래픽

팀은 경북대학교 대구캠퍼스의 장소 특징을 조사하고, 이미지 생성 도구를 이용해 게임의 픽셀 배경·아바타·도구 그림을 제작·편집했다. 지형과 가구는 실제 게임에서 이동하고 앉을 수 있도록 재구성했다. 참조 사진과 로드뷰 원본은 이 배포본에 포함하지 않는다. 화면 속 건물 사이의 방향과 거리는 게임에 맞게 조정했다.

| 배포 경로 | 내용과 제작 범위 |
| --- | --- |
| [장면 이미지](../design/stage1/assets) | 본관과 일청담, 은행나무길, 도서관, IT대학 건물·강의실의 게임용 픽셀 그림 |
| [기본 아바타](../public/campus/sprites) · [의상 시트](../design/character-v3) | 팀이 방향·동작별로 생성하고 선별한 투명 PNG와 애니메이션 좌표 |
| [아이콘](../design/stage1/assets/icons) · [가구](../design/stage1/assets/lounge) · [UI 스킨](../design/stage1/assets/skins) | 게임의 말풍선·버튼·행동·좌석을 나타내도록 제작한 이미지 |

교내 풍경을 참고할 때는 경북대학교 사진 자료와 중앙도서관 안내를 이용했다. 예를 들어 도서관의 북갤러리·휴식 마루·스마트기기존은 공식 사이버투어에서 설명한다. 각 링크의 외부 사진과 안내문은 해당 제공자의 자료다. [경북대학교 사진자료](https://photo.knu.ac.kr/) · [경북대학교 중앙도서관 사이버투어](https://kudos.knu.ac.kr/cybertour/tour03.htm) · [경북대학교 컴퓨터학부](https://cse.knu.ac.kr/)

## 폰트와 소프트웨어

| 구성 요소 | 쓰임과 출처 |
| --- | --- |
| Galmuri11, Galmuri11 Bold | 한글 픽셀 글꼴. Lee Minseo가 배포한 폰트 파일과 SIL OFL 1.1 전문을 함께 수록한다. [Galmuri 공식 저장소](https://github.com/quiple/galmuri) · [동봉된 고지](../design/stage1/assets/LICENSE.txt) |
| Node.js · SQLite | HTTP와 SSE 서버 및 로컬 공부 기록 저장. [Node.js SQLite 문서](https://nodejs.org/api/sqlite.html) |
| qrcode | 참가 링크의 QR 생성. [프로젝트 저장소](https://github.com/soldair/node-qrcode) |
| fake-indexeddb | 기기 저장소 동작을 검증하는 테스트 의존성. [프로젝트 저장소](https://github.com/dumbmatter/fakeIndexedDB) |
| esbuild · Playwright | 웹판 번들과 브라우저 점검. [esbuild](https://esbuild.github.io/) · [Playwright](https://playwright.dev/) |
| Vercel Functions | 별도 웹판의 참가자 발견과 웹 연결 경로. [Vercel Functions](https://vercel.com/docs/functions) |

설치되는 정확한 버전은 [LAN 의존성 잠금 파일](../package-lock.json)과 [웹 의존성 잠금 파일](../online/package-lock.json)에 있다. 코드와 이미지에 적용되는 사용 조건은 [라이선스](../LICENSE.md)에 정리했다.
