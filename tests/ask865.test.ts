import test from "node:test";
import assert from "node:assert/strict";
import type { AuthContext } from "../src/lib/auth/userRole";
import { hasAsk865OrganizationIdentity,isAsk865PlatformDev,matchesAsk865Organization } from "../src/lib/ask865/accessRules.js";
import { parseDashboardFilters } from "../src/lib/ask865/filters.js";
import { parseSourceReview,isSameOriginReview } from "../src/lib/ask865/review.js";
import { resolveDealershipPermissionsFromRows } from "../src/lib/auth/dealershipPermissionRules.js";

function context():AuthContext {
 const organization={id:"org-a",name:"A",slug:"a",isActive:true,createdAt:"",updatedAt:""};
 const profile={id:"user-a",email:"test@example.invalid",fullName:"Test",role:"management" as const,isActive:true,createdAt:"",updatedAt:""};
 const member={organizationId:"org-a",userId:"user-a",role:"management" as const,isActive:true,createdAt:"",updatedAt:"",organization};
 return {realUser:{id:"user-a"} as AuthContext["realUser"],realProfile:profile,realRole:"management",realOrganizationMembership:member,realOrganizationRole:"management",effectiveProfile:profile,effectiveRole:"management",effectiveOrganizationMembership:member,effectiveOrganizationRole:"management",isImpersonating:false,impersonatedProfile:null,impersonatedUserId:null,availableOrganizationMemberships:[member],currentOrganization:organization,currentOrganizationId:"org-a",currentOrganizationMembership:member};
}
test("Ask 865 requires authenticated active organization identity",()=>{
 assert.equal(hasAsk865OrganizationIdentity(context()),true);
 for(const change of [{realUser:null},{realProfile:null},{currentOrganizationId:null},{effectiveOrganizationMembership:null},{effectiveProfile:null}]) assert.equal(hasAsk865OrganizationIdentity({...context(),...change}),false);
 const c=context();c.realProfile={...c.realProfile!,isActive:false};assert.equal(hasAsk865OrganizationIdentity(c),false);
 c.realProfile={...c.realProfile,isActive:true};c.currentOrganization={...c.currentOrganization!,isActive:false};assert.equal(hasAsk865OrganizationIdentity(c),false);
});
test("another organization's membership cannot grant Ask 865 access",()=>{
 const c=context();c.effectiveOrganizationMembership={...c.effectiveOrganizationMembership!,organizationId:"org-b"};assert.equal(hasAsk865OrganizationIdentity(c),false);
 assert.equal(matchesAsk865Organization("org-a","org-b"),false);assert.equal(matchesAsk865Organization("org-a",null),false);assert.equal(matchesAsk865Organization("org-a","org-a"),true);
});
test("metadata-only dev cannot administer modules or impersonate into reporting",()=>{
 const c=context();c.realRole="dev";assert.equal(isAsk865PlatformDev(c),false);
 c.isImpersonating=true;assert.equal(hasAsk865OrganizationIdentity(c),false);
 c.realProfile=null;assert.equal(isAsk865PlatformDev(c),false);
});
test("platform dev must stop impersonating to administer modules",()=>{
 const c=context();c.realProfile={...c.realProfile!,role:"dev"};c.realRole="dev";
 assert.equal(isAsk865PlatformDev(c),true);c.isImpersonating=true;assert.equal(isAsk865PlatformDev(c),false);
 c.effectiveOrganizationMembership={...c.effectiveOrganizationMembership!,role:"sales"};c.effectiveOrganizationRole="sales";
 assert.equal(hasAsk865OrganizationIdentity(c),true); // identity alone does not grant view permission
 const perms=resolveDealershipPermissionsFromRows({role:"sales",roleRows:[],overrideRows:[]});assert.equal(perms.view_ask865,false);
});
test("report access defaults and individual denials use Atlas permissions",()=>{
 for(const role of ["sales","management","admin"] as const){
 const p=resolveDealershipPermissionsFromRows({role,roleRows:[],overrideRows:[]});assert.equal(p.view_ask865,role!=="sales");assert.equal(p.review_ask865_sources,role==="admin");
 }
 const p=resolveDealershipPermissionsFromRows({role:"admin",roleRows:[],overrideRows:[{permission_key:"view_ask865",allowed:false},{permission_key:"export_reports",allowed:false}]});assert.equal(p.view_ask865,false);assert.equal(p.export_reports,false);
});
test("date filters reject impossible, reversed and excessive ranges",()=>{
 for(const pair of [["2026-02-30","2026-03-01"],["2026-09-02","2026-09-01"],["2000-01-01","2026-01-01"],["bad","2026-01-01"]]) assert.throws(()=>parseDashboardFilters(new URLSearchParams({from:pair[0],to:pair[1]})));
 const f=parseDashboardFilters(new URLSearchParams({from:"2024-02-29",to:"2024-03-01",organization:"org-b",salesperson:"' OR true--"}));assert.equal(f.from,"2024-02-29");assert.equal(f.salesperson,"' OR true--");assert.equal("organization" in f,false);
});
test("source review cannot resolve source errors or accept unbounded content",()=>{
 const r={reportKey:"report",issueCode:"issue",owner:"Owner",notes:"Follow up",status:"in_review"};assert.deepEqual(parseSourceReview(r),r);
 for(const c of [{status:"resolved"},{owner:null},{notes:"x".repeat(2001)},{reportKey:""}]) assert.equal(parseSourceReview({...r,...c}),null);
 assert.equal(parseSourceReview(null),null);
});

test("source review origin follows the external request host, not a standalone bind host",()=>{
 assert.equal(isSameOriginReview("http://127.0.0.1:4019","127.0.0.1:4019"),true);
 assert.equal(isSameOriginReview("https://atlas.trivianfinance.com","atlas.trivianfinance.com"),true);
 assert.equal(isSameOriginReview("https://evil.example","atlas.trivianfinance.com"),false);
 assert.equal(isSameOriginReview("https://atlas.trivianfinance.com.evil.example","atlas.trivianfinance.com"),false);
 assert.equal(isSameOriginReview(null,"atlas.trivianfinance.com"),false);
});
