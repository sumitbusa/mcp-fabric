package com.demo.broker.model;

public class BrokerDealSearchRequest {
    private String currency;
    private String accountId;
    private String investorId;
    private String issuerId;
    private String maturityBucket;
    private String status;
    private Integer limit;

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public String getInvestorId() { return investorId; }
    public void setInvestorId(String investorId) { this.investorId = investorId; }
    public String getIssuerId() { return issuerId; }
    public void setIssuerId(String issuerId) { this.issuerId = issuerId; }
    public String getMaturityBucket() { return maturityBucket; }
    public void setMaturityBucket(String maturityBucket) { this.maturityBucket = maturityBucket; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getLimit() { return limit; }
    public void setLimit(Integer limit) { this.limit = limit; }
}
