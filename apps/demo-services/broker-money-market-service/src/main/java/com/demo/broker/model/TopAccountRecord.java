package com.demo.broker.model;

public class TopAccountRecord {
    private Integer rank;
    private String accountId;
    private Double outstanding;
    private String currency;
    private String investorId;
    private String issuerId;

    public Integer getRank() { return rank; }
    public void setRank(Integer rank) { this.rank = rank; }
    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public Double getOutstanding() { return outstanding; }
    public void setOutstanding(Double outstanding) { this.outstanding = outstanding; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public String getInvestorId() { return investorId; }
    public void setInvestorId(String investorId) { this.investorId = investorId; }
    public String getIssuerId() { return issuerId; }
    public void setIssuerId(String issuerId) { this.issuerId = issuerId; }
}
